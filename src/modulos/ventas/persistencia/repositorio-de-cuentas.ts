import { sql, type Kysely } from "kysely";
import {
  personaId,
  sucursalId,
  type EmpresaId,
  type PersonaId,
} from "../../../primitivas/identificadores/marca";
import { insertarIdempotente } from "../../catalogo/publico";
import { crearRepositorioDeLineas, type RepositorioDeLineas } from "./repositorio-de-lineas";
import type { Ancla } from "../dominio/ancla";
import type { EstadoDeCuenta } from "../dominio/estados";
import { cuentaId, esUuid, type CuentaId } from "../dominio/identificadores";
import type { VentasDb } from "./esquema";
import type { AltaDeCuenta, Cuenta } from "./modelo-de-cuentas";

export type { AltaDeCuenta, AltaDeLinea, Cuenta, Linea, OpcionDeLinea } from "./modelo-de-cuentas";

/**
 * Persistencia de la cuenta y sus líneas (E4 §3.3 y §3.4). Todo corre dentro de la transacción del caso de uso, filtra SIEMPRE por la
 * empresa (y la RLS lo repite) y no usa caché. Un id que no es un uuid no puede ser el de nada: devuelve «no existe» sin tocar la base.
 */
export interface RepositorioDeCuentasSolas {
  /**
   * `INSERT ... ON CONFLICT DO NOTHING` (sin objetivo: cubre también la única del ancla) y, si no insertó, `true` si la cuenta con ese id ya
   * existía (repetición) o la única que chocó era otra (propaga el error de unicidad tal cual, para que el caso de uso la traduzca).
   */
  insertar(empresa: EmpresaId, alta: AltaDeCuenta): Promise<boolean>;
  obtener(empresa: EmpresaId, id: CuentaId): Promise<Cuenta | null>;
  /** La cuenta ABIERTA de un ancla, si hay. */
  abiertaPorAncla(empresa: EmpresaId, ancla: Ancla): Promise<Cuenta | null>;
  /**
   * Las cuentas ABIERTAS de varias anclas del mismo tipo en UNA lectura (el mapa de mesas no hace una consulta por mesa), por id de ancla.
   * Una ancla sin cuenta abierta no aparece.
   */
  abiertasPorAnclas(
    empresa: EmpresaId,
    tipo: string,
    anclaIds: readonly string[],
  ): Promise<Cuenta[]>;
  /**
   * Mueve el ancla de una cuenta ABIERTA (cambiar de mesa, 0038): `UPDATE … WHERE estado = 'ABIERTA'`; `false` si ya no lo estaba. Si el ancla
   * nueva ya tiene otra cuenta abierta, la única de la base lo rechaza (error de unicidad que el caso de uso traduce a `ANCLA_OCUPADA`).
   */
  reanclar(empresa: EmpresaId, id: CuentaId, ancla: Ancla): Promise<boolean>;
  /**
   * Reserva la próxima posición: `UPDATE ... SET ultima_posicion = ultima_posicion + 1 WHERE estado = 'ABIERTA'`. Es el árbitro de
   * agregar contra cerrar y contra otro agregar: devuelve la posición, o `null` si la cuenta ya no está abierta (o no existe).
   */
  reservarPosicion(empresa: EmpresaId, id: CuentaId): Promise<number | null>;
  /** Fija el total provisorio (texto decimal con 2 decimales) de una cuenta abierta. */
  fijarTotal(empresa: EmpresaId, id: CuentaId, total: string): Promise<boolean>;
  /** `ABIERTA → CERRADA`; `false` si ya no estaba abierta (0 filas). */
  cerrar(empresa: EmpresaId, id: CuentaId, persona: PersonaId, ahora: Date): Promise<boolean>;
  /** `ABIERTA → ANULADA` con su motivo; `false` si ya no estaba abierta. */
  anular(
    empresa: EmpresaId,
    id: CuentaId,
    persona: PersonaId,
    ahora: Date,
    motivo: string,
  ): Promise<boolean>;
}

type FilaDeCuenta = Readonly<{
  id: string;
  sucursal_id: string;
  ancla_tipo: string | null;
  ancla_id: string | null;
  etiqueta: string | null;
  estado: EstadoDeCuenta;
  total_provisorio: string;
  ultima_posicion: number;
  abierta_por: string;
  abierta_en: Date;
  resuelta_por: string | null;
  resuelta_en: Date | null;
  motivo: string | null;
  version: number;
}>;

function aCuenta(f: FilaDeCuenta): Cuenta {
  return {
    id: cuentaId(f.id),
    sucursalId: sucursalId(f.sucursal_id),
    ancla:
      f.ancla_tipo === null || f.ancla_id === null ? null : { tipo: f.ancla_tipo, id: f.ancla_id },
    etiqueta: f.etiqueta,
    estado: f.estado,
    totalProvisorio: f.total_provisorio,
    ultimaPosicion: f.ultima_posicion,
    abiertaPor: personaId(f.abierta_por),
    abiertaEn: f.abierta_en,
    resueltaPor: f.resuelta_por === null ? null : personaId(f.resuelta_por),
    resueltaEn: f.resuelta_en,
    motivo: f.motivo,
    version: f.version,
  };
}

export type RepositorioDeCuentas = RepositorioDeCuentasSolas & RepositorioDeLineas;

export function crearRepositorioDeCuentas(db: Kysely<VentasDb>): RepositorioDeCuentas {
  const seleccionarCuenta = () =>
    db
      .selectFrom("cuenta_consumo")
      .select([
        "id",
        "sucursal_id",
        "ancla_tipo",
        "ancla_id",
        "etiqueta",
        "estado",
        "total_provisorio",
        "ultima_posicion",
        "abierta_por",
        "abierta_en",
        "resuelta_por",
        "resuelta_en",
        "motivo",
        "version",
      ]);
  return {
    ...crearRepositorioDeLineas(db),
    async insertar(empresa, alta) {
      const armar = () =>
        db.insertInto("cuenta_consumo").values({
          id: alta.id,
          empresa_id: empresa,
          sucursal_id: alta.sucursalId,
          ancla_tipo: alta.ancla === null ? null : alta.ancla.tipo,
          ancla_id: alta.ancla === null ? null : alta.ancla.id,
          etiqueta: alta.etiqueta,
          abierta_por: alta.abiertaPor,
          abierta_en: alta.abiertaEn,
        });
      const fila = await insertarIdempotente(
        () =>
          armar()
            .onConflict((oc) => oc.doNothing())
            .returning("id")
            .executeTakeFirst(),
        async () =>
          (await db
            .selectFrom("cuenta_consumo")
            .select("id")
            .where("empresa_id", "=", empresa)
            .where("id", "=", alta.id)
            .executeTakeFirst()) !== undefined,
        () => armar().returning("id").executeTakeFirstOrThrow(),
      );
      return fila !== undefined;
    },

    async obtener(empresa, id) {
      if (!esUuid(id)) return null;
      const fila = await seleccionarCuenta()
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .executeTakeFirst();
      return fila === undefined ? null : aCuenta(fila);
    },

    async abiertaPorAncla(empresa, ancla) {
      if (!esUuid(ancla.id)) return null;
      const fila = await seleccionarCuenta()
        .where("empresa_id", "=", empresa)
        .where("ancla_tipo", "=", ancla.tipo)
        .where("ancla_id", "=", ancla.id)
        .where("estado", "=", "ABIERTA")
        .executeTakeFirst();
      return fila === undefined ? null : aCuenta(fila);
    },

    async abiertasPorAnclas(empresa, tipo, anclaIds) {
      const ids = anclaIds.filter(esUuid);
      if (ids.length === 0) return [];
      const filas = await seleccionarCuenta()
        .where("empresa_id", "=", empresa)
        .where("ancla_tipo", "=", tipo)
        .where("ancla_id", "in", ids)
        .where("estado", "=", "ABIERTA")
        .orderBy("ancla_id")
        .execute();
      return filas.map(aCuenta);
    },

    async reanclar(empresa, id, ancla) {
      if (!esUuid(id) || !esUuid(ancla.id)) return false;
      const r = await db
        .updateTable("cuenta_consumo")
        .set({ ancla_tipo: ancla.tipo, ancla_id: ancla.id })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("estado", "=", "ABIERTA")
        .executeTakeFirst();
      return r.numUpdatedRows === 1n;
    },

    async reservarPosicion(empresa, id) {
      if (!esUuid(id)) return null;
      const fila = await db
        .updateTable("cuenta_consumo")
        .set({ ultima_posicion: sql<number>`ultima_posicion + 1` })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("estado", "=", "ABIERTA")
        .returning("ultima_posicion")
        .executeTakeFirst();
      return fila === undefined ? null : fila.ultima_posicion;
    },

    async fijarTotal(empresa, id, total) {
      const r = await db
        .updateTable("cuenta_consumo")
        .set({ total_provisorio: total })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("estado", "=", "ABIERTA")
        .executeTakeFirst();
      return r.numUpdatedRows === 1n;
    },

    async cerrar(empresa, id, persona, ahora) {
      if (!esUuid(id)) return false;
      const r = await db
        .updateTable("cuenta_consumo")
        .set({ estado: "CERRADA", resuelta_por: persona, resuelta_en: ahora })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("estado", "=", "ABIERTA")
        .executeTakeFirst();
      return r.numUpdatedRows === 1n;
    },

    async anular(empresa, id, persona, ahora, motivo) {
      if (!esUuid(id)) return false;
      const r = await db
        .updateTable("cuenta_consumo")
        .set({ estado: "ANULADA", resuelta_por: persona, resuelta_en: ahora, motivo })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("estado", "=", "ABIERTA")
        .executeTakeFirst();
      return r.numUpdatedRows === 1n;
    },
  };
}
