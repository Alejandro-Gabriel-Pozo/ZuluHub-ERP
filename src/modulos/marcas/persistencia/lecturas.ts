import { sql, type Kysely } from "kysely";
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
import {
  decidirConfiguracionPublica,
  type ConfiguracionPublica,
  type VersionPublicaDeMarca,
} from "../dominio/configuracion-publica";
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

  /**
   * La configuración pública de la marca de un host: su nombre, su tema validado (con la herencia de la
   * cadena de marcas) y el host canónico de su aplicación. Se sirve bajo EXACTAMENTE el mismo criterio
   * que `resolverHost` (es la misma consulta, no una copia) y devuelve `null` en todo lo demás, sin
   * distinguir por qué. Nada de ids, empresa ni tenant. Una sola foto de la base (la de la transacción):
   * una versión nueva que se confirma mientras tanto se ve entera o no se ve, nunca a medias.
   */
  configuracionDeHost(
    host: Host,
    superficie: SuperficieDeDominio,
  ): Promise<ConfiguracionPublica | null>;
}

/** La cadena de herencia llega a tres marcas (la base limita el nivel a 2): se corta ahí por si acaso. */
const ESLABONES_MAXIMOS_DE_LA_CADENA = 3;

/** Un valor de la base que el CHECK correspondiente no deja pasar: si llega otro, algo se rompió. */
function superficieDeLaBase(valor: string): SuperficieDeDominio {
  const encontrada = SUPERFICIES_DE_DOMINIO.find((s) => s === valor);
  if (encontrada === undefined) throw new RangeError(`superficie desconocida en la base: ${valor}`);
  return encontrada;
}

/**
 * El host servible y nada más: la vista de 0007 (dominio ACTIVO de marca ACTIVA) y, además, que la marca
 * tenga al menos una versión confirmada y ya empezada (la política pública de `version_de_marca`). Es el
 * ÚNICO lugar donde vive el criterio «se puede servir»: la resolución y la configuración lo comparten.
 */
async function buscarHostServible(
  db: Kysely<PublicoDb>,
  host: Host,
  superficie: SuperficieDeDominio,
): Promise<HostServible | null> {
  const fila = await db
    .selectFrom("resolucion_de_host as r")
    .select(["r.host", "r.superficie", "r.duenio_marca_id", "r.duenio_empresa_id", "r.marca_id"])
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
}

export function crearLecturaPublicaDeMarcas(db: Kysely<PublicoDb>): LecturaPublicaDeMarcas {
  return {
    resolverHost: (host, superficie) => buscarHostServible(db, host, superficie),

    async configuracionDeHost(host, superficie) {
      const servible = await buscarHostServible(db, host, superficie);
      if (servible === null) return null;

      // La marca y sus ancestros, de la marca hacia arriba. La política pública de `marca` deja ver solo
      // las ACTIVAS: un ancestro retirado corta la cadena y sus colores dejan de heredarse. `ahora` es la
      // hora de la base en esta transacción: la misma contra la que la política de `version_de_marca`
      // decide qué versiones ya empezaron (no se mezcla con el reloj de la aplicación).
      const cadena = await sql<{ id: string; ahora: Date }>`
        with recursive cadena (id, marca_padre_id, profundidad) as (
          select m.id, m.marca_padre_id, 0 from marca m where m.id = ${servible.marcaId}
          union all
          select p.id, p.marca_padre_id, c.profundidad + 1
            from marca p join cadena c on p.id = c.marca_padre_id
           where c.profundidad + 1 < ${ESLABONES_MAXIMOS_DE_LA_CADENA}
        )
        select id, now() as ahora from cadena order by profundidad`.execute(db);
      const ahora = cadena.rows[0]?.ahora;
      if (ahora === undefined) return null;
      const ids = cadena.rows.map((r) => r.id);

      const versiones = await db
        .selectFrom("version_de_marca")
        .select(["marca_id", "numero", "vigente_desde", "nombre_visible", "tema"])
        .where("marca_id", "in", ids)
        .execute();
      // Las políticas dejan pasar solo versiones confirmadas (con número y vigencia).
      const deLaMarca = (id: string): readonly VersionPublicaDeMarca[] =>
        versiones.flatMap((v) =>
          v.marca_id !== id || v.numero === null || v.vigente_desde === null
            ? []
            : [
                {
                  numero: v.numero,
                  vigenteDesde: v.vigente_desde,
                  nombreVisible: v.nombre_visible,
                  tema: v.tema,
                },
              ],
        );

      // El host canónico de la aplicación de la PROPIA marca (no se hereda): ACTIVO por la política.
      const canonico = await db
        .selectFrom("dominio")
        .select("host")
        .where("duenio_marca_id", "=", servible.marcaId)
        .where("superficie", "=", "APP")
        .where("es_canonico", "=", true)
        .limit(1)
        .executeTakeFirst();

      return decidirConfiguracionPublica({
        cadena: ids.map(deLaMarca),
        // El CHECK `dominio_host_ck` garantiza la forma de un host normalizado.
        hostCanonico: canonico === undefined ? null : (canonico.host as Host),
        ahora,
      });
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
