import type { Kysely } from "kysely";
import {
  empresaId,
  marcaComercialId,
  type MarcaComercialId,
  type TenantId,
} from "../../../primitivas/identificadores/marca";
import {
  SUPERFICIES_DE_DOMINIO,
  type DuenioDeDominio,
  type SuperficieDeDominio,
} from "../dominio/ciclo-de-dominio";
import type { Host } from "../dominio/host";
import type { DatosDeMarcaParaMail } from "../dominio/marca-de-mail";
import { versionVigente } from "../dominio/vigencia";
import type { MarcasParaMailDb, PublicoDb } from "./tablas";

/**
 * Lecturas de marcas que NO son de plataforma (ADR-005): la resolución pública de un host y los datos de
 * la marca de un tenant para sus mails. Solo leen; no hay ninguna escritura acá. Ninguna restricción
 * ni error de la base se atrapa: salen tal cual y el adaptador de transacciones los tipa.
 */

/** Un host que se puede servir: lo único que la puerta pública sabe de él. */
export type HostServible = Readonly<{
  host: Host;
  superficie: SuperficieDeDominio;
  duenio: DuenioDeDominio;
  marcaId: MarcaComercialId;
}>;

export interface LecturaPublicaDeMarcas {
  /**
   * El host para esa superficie, SOLO si se puede servir (§B.2.1). Se sirve cuando se cumplen todas:
   *  1. el dominio está ACTIVO en esa superficie (coincidencia exacta del host: la vista de 0007);
   *  2. su marca está ACTIVA (el `JOIN` de la misma vista, bajo la política pública de `marca`);
   *  3. su marca tiene al menos UNA versión confirmada y ya vigente (la política pública de
   *     `version_de_marca`): sin versión no hay nombre, tema ni logo que servir y la puerta responde la
   *     página neutra. La vista de 0007 NO exige esto; la exigencia es de esta consulta y la cubre una
   *     prueba de integración que falla si se la quita.
   * Cualquier otro caso (desconocido, retirado, en verificación, de otra superficie, de una marca
   * retirada o sin versión) es `null`, sin distinguir cuál. Una sola consulta: ningún caso toma otro
   * camino que se pueda notar.
   */
  resolverHost(host: Host, superficie: SuperficieDeDominio): Promise<HostServible | null>;
}

/** Un valor de la base que el CHECK correspondiente no deja pasar: si llega otro, algo se rompió. */
function superficieDeLaBase(valor: string): SuperficieDeDominio {
  const encontrada = SUPERFICIES_DE_DOMINIO.find((s) => s === valor);
  if (encontrada === undefined) throw new RangeError(`superficie desconocida en la base: ${valor}`);
  return encontrada;
}

export function crearLecturaPublicaDeMarcas(db: Kysely<PublicoDb>): LecturaPublicaDeMarcas {
  return {
    async resolverHost(host, superficie) {
      const fila = await db
        .selectFrom("resolucion_de_host as r")
        .select([
          "r.host",
          "r.superficie",
          "r.duenio_marca_id",
          "r.duenio_empresa_id",
          "r.marca_id",
        ])
        .where("r.host", "=", host)
        .where("r.superficie", "=", superficie)
        .where((eb) =>
          eb.exists(
            eb
              .selectFrom("version_de_marca as v")
              .select("v.marca_id")
              .whereRef("v.marca_id", "=", "r.marca_id"),
          ),
        )
        .limit(1)
        .executeTakeFirst();
      if (fila === undefined) return null;
      // El CHECK `dominio_duenio_ck` garantiza que exactamente uno de los dos dueños está definido.
      const duenio: DuenioDeDominio =
        fila.duenio_marca_id !== null
          ? { tipo: "MARCA", marcaId: marcaComercialId(fila.duenio_marca_id) }
          : { tipo: "EMPRESA", empresaId: empresaId(fila.duenio_empresa_id as string) };
      return {
        // El CHECK `dominio_host_ck` (host_valido) garantiza la misma forma que `normalizarHost`.
        host: fila.host as Host,
        superficie: superficieDeLaBase(fila.superficie),
        duenio,
        marcaId: marcaComercialId(fila.marca_id),
      };
    },
  };
}

export interface LecturaDeMarcaParaMail {
  /**
   * Lo que hace falta saber de la marca de un tenant para decidir desde dónde sale su mail
   * (`decidirMarcaDeMail`): si es la principal, el nombre visible de SU versión vigente a `ahora` y su
   * host canónico ACTIVO de la aplicación. `null` si el tenant no se ve (otro tenant, o inexistente).
   */
  delTenant(tenantId: TenantId, ahora: Date): Promise<DatosDeMarcaParaMail | null>;
}

export function crearLecturaDeMarcaParaMail(db: Kysely<MarcasParaMailDb>): LecturaDeMarcaParaMail {
  return {
    async delTenant(tenantId, ahora) {
      const tenant = await db
        .selectFrom("tenant")
        .select("marca_id")
        .where("id", "=", tenantId)
        .executeTakeFirst();
      if (tenant === undefined) return null;
      const marca = await db
        .selectFrom("marca")
        .select(["id", "es_principal"])
        .where("id", "=", tenant.marca_id)
        .executeTakeFirst();
      if (marca === undefined) return null;

      const versiones = await db
        .selectFrom("version_de_marca")
        .select(["numero", "vigente_desde", "nombre_visible"])
        .where("marca_id", "=", marca.id)
        .execute();
      // La política de 0007 deja pasar solo versiones confirmadas (con número y vigencia); `versionVigente`
      // aplica «la última decisión manda» con el `ahora` del llamador.
      const vigente = versionVigente(
        versiones.flatMap((v) =>
          v.numero === null || v.vigente_desde === null
            ? []
            : [
                {
                  numero: v.numero,
                  vigenteDesde: v.vigente_desde,
                  nombreVisible: v.nombre_visible,
                },
              ],
        ),
        ahora,
      );

      const dominio = await db
        .selectFrom("dominio")
        .select("host")
        .where("marca_id", "=", marca.id)
        .where("superficie", "=", "APP")
        .where("es_canonico", "=", true)
        .limit(1)
        .executeTakeFirst();

      return {
        esPrincipal: marca.es_principal,
        nombreVisible: vigente?.nombreVisible ?? null,
        // El CHECK `dominio_host_ck` garantiza la forma de un host normalizado.
        hostCanonico: dominio === undefined ? null : (dominio.host as Host),
      };
    },
  };
}
