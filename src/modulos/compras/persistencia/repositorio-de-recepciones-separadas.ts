import { sql, type Kysely } from "kysely";
import type { EmpresaId, PersonaId } from "../../../primitivas/identificadores/marca";
import type { ControlDeLinea } from "../dominio/control-de-recepcion";
import type { ComprasDb } from "./esquema";
import { esUuid } from "./filas";
import {
  aRecepcion,
  COLUMNAS_DE_RECEPCION,
  type EstadoDeRecepcion,
  type FilaDeRecepcion,
  type Recepcion,
} from "./repositorio-de-recepciones";

/** Con N3 (0063) una recepción puede estar PENDIENTE de confirmar: solo la ven las operaciones de N3; N1 y N2 nunca la leen (sus lecturas la excluyen). */
export type EstadoDeRecepcionSeparada = EstadoDeRecepcion | "PENDIENTE";

export type RecepcionSeparada = Omit<Recepcion, "estado"> &
  Readonly<{
    estado: EstadoDeRecepcionSeparada;
    confirmadaPor: string | null;
    confirmadaEn: Date | null;
  }>;

/**
 * Las recepciones de N3 y N4 (E9 §3.8): lo mismo que las de N1 y N2 pero viendo también las PENDIENTES, más el control de la mercadería por línea. Las lecturas son de
 * la misma tabla; N1 y N2 no pasan por acá.
 */
export type LineaConciliable = Readonly<{
  recepcionId: string;
  /** El número de la recepción y su sucursal: la pantalla de conciliar los muestra y la propuesta se limita al alcance de quien pide. */
  recepcionNumero: number;
  sucursalId: string;
  linea: number;
  productoId: string;
  recibida: string;
  asignada: string;
}>;

export type EntradaDeLinea = Readonly<{
  linea: number;
  depositoId: string;
  movimientoId: string;
  cantidad: string;
}>;

export interface RepositorioDeRecepcionesSeparadas {
  /** Como `porClave` de N1 y N2, pero ve también las PENDIENTES. */
  porClaveSeparada(empresa: EmpresaId, clave: string): Promise<RecepcionSeparada | null>;
  /** Como `porRemito`, pero ve también las PENDIENTES. */
  porRemitoSeparado(
    empresa: EmpresaId,
    proveedorId: string,
    puntoDeVenta: number,
    numero: number,
  ): Promise<RecepcionSeparada | null>;
  obtenerSeparada(empresa: EmpresaId, id: string): Promise<RecepcionSeparada | null>;
  /** Con `FOR UPDATE`: confirmar y anular una pendiente se serializan por acá. */
  bloquearSeparada(empresa: EmpresaId, id: string): Promise<RecepcionSeparada | null>;
  /** El control de la mercadería por línea (misma transacción que la recepción). */
  insertarControles(
    empresa: EmpresaId,
    recepcionId: string,
    controles: readonly ControlDeLinea[],
  ): Promise<void>;
  controlesDe(empresa: EmpresaId, recepcionId: string): Promise<readonly ControlDeLinea[]>;
  /**
   * Las líneas recibidas de ese proveedor que se pueden conciliar: de recepciones CONFIRMADAS de N3 o N4, sin las que el control dejó RECHAZADAS, la más vieja primero
   * (por número de recepción y línea), con lo recibido y lo ya asignado. Con `sucursales` (el alcance de quien pide) solo las de esas sucursales; es obligatorio (todo nace cerrado): quien necesita todas lo dice con «TODAS» (el caso de uso que
   * concilia las lee todas y verifica el alcance de cada recepción por su cuenta, para dar el motivo exacto).
   */
  lineasConciliables(
    empresa: EmpresaId,
    proveedorId: string,
    sucursales: "TODAS" | readonly string[],
  ): Promise<readonly LineaConciliable[]>;
  /** PENDIENTE → CONFIRMADA con quién la confirmó (la hora la fija la base). `false` si ya no estaba PENDIENTE. */
  confirmar(empresa: EmpresaId, id: string, por: PersonaId): Promise<boolean>;
  /** PENDIENTE → ANULADA con su motivo. `false` si ya no estaba PENDIENTE. */
  anularPendiente(
    empresa: EmpresaId,
    id: string,
    anulacion: Readonly<{ por: PersonaId; en: Date; motivo: string }>,
  ): Promise<boolean>;
  /** Lo que entró a stock por línea y depósito (solo en la transacción que confirma). */
  insertarEntradas(
    empresa: EmpresaId,
    recepcionId: string,
    entradas: readonly EntradaDeLinea[],
  ): Promise<void>;
  entradasDe(empresa: EmpresaId, recepcionId: string): Promise<readonly EntradaDeLinea[]>;
}

export function aRecepcionSeparada(f: FilaDeRecepcion): RecepcionSeparada {
  if (f.estado !== "PENDIENTE" && f.estado !== "CONFIRMADA" && f.estado !== "ANULADA") {
    throw new RangeError(`estado de recepción desconocido: ${f.estado}`);
  }
  // `aRecepcion` solo conoce los dos estados de N1 y N2: se lo lee como CONFIRMADA y se pone el verdadero.
  const base = aRecepcion({ ...f, estado: f.estado === "PENDIENTE" ? "CONFIRMADA" : f.estado });
  return {
    ...base,
    estado: f.estado,
    confirmadaPor: f.confirmada_por,
    confirmadaEn: f.confirmada_en,
  };
}

function aControl(f: {
  linea: number;
  condicion: string;
  observacion: string | null;
  cantidad_segun_remito: string | null;
  temperatura_en_c: string | null;
}): ControlDeLinea {
  if (
    f.condicion !== "CONFORME" &&
    f.condicion !== "CON_OBSERVACIONES" &&
    f.condicion !== "RECHAZADA"
  ) {
    throw new RangeError(`condición de control desconocida: ${f.condicion}`);
  }
  return {
    linea: f.linea,
    condicion: f.condicion,
    observacion: f.observacion,
    cantidadSegunRemito: f.cantidad_segun_remito,
    temperaturaEnC: f.temperatura_en_c,
  };
}

export function crearRepositorioDeRecepcionesSeparadas(
  db: Kysely<ComprasDb>,
): RepositorioDeRecepcionesSeparadas {
  async function leerSeparada(empresa: EmpresaId, id: string, bloquear: boolean) {
    if (!esUuid(id)) return null;
    let consulta = db
      .selectFrom("recepcion")
      .select(COLUMNAS_DE_RECEPCION)
      .where("empresa_id", "=", empresa)
      .where("id", "=", id);
    if (bloquear) consulta = consulta.forUpdate();
    const fila = await consulta.executeTakeFirst();
    return fila === undefined ? null : aRecepcionSeparada(fila);
  }
  return {
    async lineasConciliables(empresa, proveedorId, sucursales) {
      if (!esUuid(proveedorId)) return [];
      if (sucursales !== "TODAS" && sucursales.length === 0) return [];
      let consulta = db
        .selectFrom("recepcion as r")
        .innerJoin("linea_de_recepcion as l", (j) =>
          j.onRef("l.empresa_id", "=", "r.empresa_id").onRef("l.recepcion_id", "=", "r.id"),
        )
        .innerJoin("saldo_de_linea_de_recepcion as s", (j) =>
          j
            .onRef("s.empresa_id", "=", "l.empresa_id")
            .onRef("s.recepcion_id", "=", "l.recepcion_id")
            .onRef("s.numero", "=", "l.numero"),
        )
        .select([
          "r.id as recepcion_id",
          "r.numero as recepcion_numero",
          "r.sucursal_id",
          "l.numero as linea",
          "l.producto_id",
          sql<string>`s.cantidad_recibida::text`.as("recibida"),
          sql<string>`s.cantidad_asignada::text`.as("asignada"),
        ])
        .where("r.empresa_id", "=", empresa)
        .where("r.proveedor_id", "=", proveedorId)
        .where("r.estado", "=", "CONFIRMADA")
        .where("r.nivel", "in", ["RECEPCION_SEPARADA", "TRES_VIAS"])
        .where(
          sql<boolean>`not exists (select 1 from inspeccion_de_linea_de_recepcion i
            where i.empresa_id = l.empresa_id and i.recepcion_id = l.recepcion_id and i.linea = l.numero and i.condicion = 'RECHAZADA')`,
        );
      if (sucursales !== "TODAS") consulta = consulta.where("r.sucursal_id", "in", [...sucursales]);
      const filas = await consulta.orderBy("r.numero").orderBy("l.numero").execute();
      return filas.map((f) => ({
        recepcionId: f.recepcion_id,
        recepcionNumero: f.recepcion_numero,
        sucursalId: f.sucursal_id,
        linea: f.linea,
        productoId: f.producto_id,
        recibida: f.recibida,
        asignada: f.asignada,
      }));
    },
    async confirmar(empresa, id, por) {
      const fila = await db
        .updateTable("recepcion")
        .set({ estado: "CONFIRMADA", confirmada_por: por })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("estado", "=", "PENDIENTE")
        .returning("id")
        .executeTakeFirst();
      return fila !== undefined;
    },
    async anularPendiente(empresa, id, anulacion) {
      const fila = await db
        .updateTable("recepcion")
        .set({
          estado: "ANULADA",
          anulada_por: anulacion.por,
          anulada_en: anulacion.en,
          motivo_de_anulacion: anulacion.motivo,
        })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("estado", "=", "PENDIENTE")
        .returning("id")
        .executeTakeFirst();
      return fila !== undefined;
    },
    async insertarEntradas(empresa, recepcionId, entradas) {
      if (entradas.length === 0) return;
      await db
        .insertInto("entrada_de_linea_de_recepcion")
        .values(
          entradas.map((e) => ({
            empresa_id: empresa,
            recepcion_id: recepcionId,
            linea: e.linea,
            deposito_id: e.depositoId,
            movimiento_id: e.movimientoId,
            cantidad: e.cantidad,
          })),
        )
        .execute();
    },
    async entradasDe(empresa, recepcionId) {
      if (!esUuid(recepcionId)) return [];
      const filas = await db
        .selectFrom("entrada_de_linea_de_recepcion")
        .select([
          "linea",
          "deposito_id",
          "movimiento_id",
          sql<string>`cantidad::text`.as("cantidad"),
        ])
        .where("empresa_id", "=", empresa)
        .where("recepcion_id", "=", recepcionId)
        .orderBy("linea")
        .orderBy("deposito_id")
        .execute();
      return filas.map((f) => ({
        linea: f.linea,
        depositoId: f.deposito_id,
        movimientoId: f.movimiento_id,
        cantidad: f.cantidad,
      }));
    },
    async porClaveSeparada(empresa, clave) {
      const fila = await db
        .selectFrom("recepcion")
        .select(COLUMNAS_DE_RECEPCION)
        .where("empresa_id", "=", empresa)
        .where("clave_idempotencia", "=", clave)
        .executeTakeFirst();
      return fila === undefined ? null : aRecepcionSeparada(fila);
    },
    async porRemitoSeparado(empresa, proveedorId, puntoDeVenta, numero) {
      const fila = await db
        .selectFrom("recepcion")
        .select(COLUMNAS_DE_RECEPCION)
        .where("empresa_id", "=", empresa)
        .where("proveedor_id", "=", proveedorId)
        .where("remito_punto_de_venta", "=", puntoDeVenta)
        .where("remito_numero", "=", numero)
        .where("estado", "in", ["PENDIENTE", "CONFIRMADA"])
        .executeTakeFirst();
      return fila === undefined ? null : aRecepcionSeparada(fila);
    },
    obtenerSeparada: (empresa, id) => leerSeparada(empresa, id, false),
    bloquearSeparada: (empresa, id) => leerSeparada(empresa, id, true),
    async insertarControles(empresa, recepcionId, controles) {
      if (controles.length === 0) return;
      await db
        .insertInto("inspeccion_de_linea_de_recepcion")
        .values(
          controles.map((c) => ({
            empresa_id: empresa,
            recepcion_id: recepcionId,
            linea: c.linea,
            cantidad_segun_remito: c.cantidadSegunRemito,
            condicion: c.condicion,
            observacion: c.observacion,
            temperatura_en_c: c.temperaturaEnC,
          })),
        )
        .execute();
    },
    async controlesDe(empresa, recepcionId) {
      if (!esUuid(recepcionId)) return [];
      const filas = await db
        .selectFrom("inspeccion_de_linea_de_recepcion")
        .select([
          "linea",
          "condicion",
          "observacion",
          sql<string | null>`cantidad_segun_remito::text`.as("cantidad_segun_remito"),
          sql<string | null>`temperatura_en_c::text`.as("temperatura_en_c"),
        ])
        .where("empresa_id", "=", empresa)
        .where("recepcion_id", "=", recepcionId)
        .orderBy("linea")
        .execute();
      return filas.map((f) => aControl(f));
    },
  };
}
