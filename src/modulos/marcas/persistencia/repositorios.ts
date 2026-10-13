import { sql, type Kysely, type Selectable } from "kysely";
import {
  dominioId,
  empresaId,
  marcaComercialId,
  type DominioId,
  type MarcaComercialId,
} from "../../../primitivas/identificadores/marca";
import {
  ESTADOS_DE_DOMINIO,
  SUPERFICIES_DE_DOMINIO,
  TITULARES_DE_DOMINIO,
  type CambioDeEstadoDeDominio,
  type DominioPorAgregar,
  type DuenioDeDominio,
  type EstadoDeDominio,
  type SuperficieDeDominio,
  type TitularDeDominio,
} from "../dominio/ciclo-de-dominio";
import type { Host } from "../dominio/host";
import type { DominiosDb } from "./tablas";

/**
 * Repositorio de dominios (ADR-005, ADR-009). Cada método tiene una intención y devuelve tipos del
 * dominio. Reglas de este archivo:
 *
 *  - Es de PLATAFORMA: la aplicación, el grupo y los trabajos no tienen permiso sobre `dominio` (solo la
 *    plataforma lo escribe, y solo un ADMIN; el rol público lee la vista de resolución, no esta tabla).
 *  - El cambio es `UPDATE ... WHERE version = <la que se leyó>` y devuelve la fila nueva, o `null` si no
 *    la tocó (otra transacción cambió antes, o no existe): nada de `FOR UPDATE` ni de upserts.
 *  - Ninguna restricción de la base se atrapa acá: salen tal cual y el adaptador de transacciones las
 *    traduce a `ErrorDePersistencia` (la traducción a motivos de negocio está en `traducir.ts`).
 *  - Quién registró el host NO lo elige quien llama: lo escribe `app_actor_plataforma()`, el actor del
 *    contexto firmado, y la política de la base exige que coincida.
 */

/** Un dominio tal como está guardado. */
export type DominioGuardado = Readonly<{
  id: DominioId;
  host: Host;
  superficie: SuperficieDeDominio;
  titular: TitularDeDominio;
  duenio: DuenioDeDominio;
  /** La marca por cuya puerta se entra: la dueña, o la del tenant de la empresa dueña. */
  marcaId: MarcaComercialId;
  esCanonico: boolean;
  estado: EstadoDeDominio;
  verificadoEn: Date | null;
  motivo: string | null;
  /** El actor de plataforma que lo registró (su id). */
  registradoPor: string;
  version: number;
}>;

export interface RepositorioDeDominios {
  /** Un dominio por su id; `null` si no existe. */
  obtener(id: DominioId): Promise<DominioGuardado | null>;
  /**
   * Registra el host: nace PENDIENTE_VERIFICACION. El host duplicado, el canónico repetido, la marca
   * retirada o inexistente y el resto de las reglas las impone la base y salen como error de la base.
   */
  crear(alta: DominioPorAgregar): Promise<DominioGuardado>;
  /**
   * Aplica el cambio de estado solo si la versión coincide; `null` si no (otra transacción cambió antes
   * o el dominio no existe). La fecha de verificación se fija al verificar y se borra al volver a pendiente.
   */
  cambiarEstado(
    id: DominioId,
    versionEsperada: number,
    cambio: CambioDeEstadoDeDominio,
  ): Promise<DominioGuardado | null>;
}

/** Un valor de la base que el CHECK correspondiente no deja pasar: si llega otro, algo se rompió. */
function deLaLista<T extends string>(lista: readonly T[], valor: string, nombre: string): T {
  const encontrado = lista.find((v) => v === valor);
  if (encontrado === undefined) throw new RangeError(`${nombre} desconocido en la base: ${valor}`);
  return encontrado;
}

function aDominio(fila: Selectable<DominiosDb["dominio"]>): DominioGuardado {
  const duenio: DuenioDeDominio =
    fila.duenio_marca_id !== null
      ? { tipo: "MARCA", marcaId: marcaComercialId(fila.duenio_marca_id) }
      : { tipo: "EMPRESA", empresaId: empresaId(fila.duenio_empresa_id as string) };
  return {
    id: dominioId(fila.id),
    // El CHECK `dominio_host_ck` (host_valido) garantiza la misma forma que `normalizarHost`.
    host: fila.host as Host,
    superficie: deLaLista(SUPERFICIES_DE_DOMINIO, fila.superficie, "superficie"),
    titular: deLaLista(TITULARES_DE_DOMINIO, fila.titular, "titular"),
    duenio,
    marcaId: marcaComercialId(fila.marca_id),
    esCanonico: fila.es_canonico,
    estado: deLaLista(ESTADOS_DE_DOMINIO, fila.estado, "estado"),
    verificadoEn: fila.verificado_en,
    motivo: fila.motivo,
    registradoPor: fila.registrado_por,
    version: fila.version,
  };
}

/** Las columnas que cada cambio toca (la plataforma solo puede actualizar estas tres). */
function columnasDelCambio(cambio: CambioDeEstadoDeDominio) {
  switch (cambio.estado) {
    case "VERIFICADO":
      return { estado: cambio.estado, verificado_en: cambio.verificadoEn };
    case "PENDIENTE_VERIFICACION":
      return { estado: cambio.estado, verificado_en: null };
    case "RETIRADO":
      return { estado: cambio.estado, motivo: cambio.motivo };
    case "ACTIVO":
      return { estado: cambio.estado };
  }
}

export function crearRepositorioDeDominios(db: Kysely<DominiosDb>): RepositorioDeDominios {
  return {
    async obtener(id) {
      const fila = await db
        .selectFrom("dominio")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();
      return fila === undefined ? null : aDominio(fila);
    },

    async crear(alta) {
      const fila = await db
        .insertInto("dominio")
        .values({
          host: alta.host,
          superficie: alta.superficie,
          duenio_marca_id: alta.duenio.tipo === "MARCA" ? alta.duenio.marcaId : null,
          duenio_empresa_id: alta.duenio.tipo === "EMPRESA" ? alta.duenio.empresaId : null,
          titular: alta.titular,
          es_canonico: alta.esCanonico,
          registrado_por: sql<string>`(select app_actor_plataforma())`,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return aDominio(fila);
    },

    async cambiarEstado(id, versionEsperada, cambio) {
      const fila = await db
        .updateTable("dominio")
        .set(columnasDelCambio(cambio))
        .where("id", "=", id)
        .where("version", "=", versionEsperada)
        .returningAll()
        .executeTakeFirst();
      return fila === undefined ? null : aDominio(fila);
    },
  };
}
