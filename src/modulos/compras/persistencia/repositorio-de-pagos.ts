import { sql, type Kysely } from "kysely";
import type { EmpresaId, PersonaId } from "../../../primitivas/identificadores/marca";
import { esMedioDePago, type MedioDePago } from "../dominio/pago";
import type { ComprasDb } from "./esquema";
import { esUuid } from "./filas";

export type EstadoDePago = "VIGENTE" | "ANULADO";

export type PagoGuardado = Readonly<{
  id: string;
  comprobanteId: string;
  fechaDePago: string;
  medio: MedioDePago;
  /** Texto decimal de 2 decimales: el total del comprobante al declarar el pago. */
  importe: string;
  estado: EstadoDePago;
  claveIdempotencia: string;
  huella: string;
  registradoPor: string;
  registradoEn: Date;
  anuladoPor: string | null;
  anuladoEn: Date | null;
  motivoDeAnulacion: string | null;
  version: number;
}>;

export type AltaDePago = Readonly<{
  comprobanteId: string;
  fechaDePago: string;
  medio: MedioDePago;
  importe: string;
  clave: string;
  huella: string;
  registradoPor: PersonaId;
}>;

/**
 * Los pagos de las facturas (E9 §3.6). Un pago VIGENTE por factura (único parcial de la base): `insertar` usa `ON CONFLICT DO NOTHING` sin objetivo y devuelve
 * `undefined` si chocó con la clave o con ese único; quien llama ya buscó antes. Lo único que cambia de un pago es su anulación (queda el registro: se anula con
 * un cambio de estado con quién, cuándo y por qué, y se puede declarar otro).
 */
export interface RepositorioDePagos {
  porClave(empresa: EmpresaId, clave: string): Promise<PagoGuardado | null>;
  obtener(empresa: EmpresaId, id: string): Promise<PagoGuardado | null>;
  bloquear(empresa: EmpresaId, id: string): Promise<PagoGuardado | null>;
  /** El pago VIGENTE del comprobante, o `null`. */
  vigenteDe(empresa: EmpresaId, comprobanteId: string): Promise<PagoGuardado | null>;
  /** Los pagos VIGENTES de esos comprobantes (a lo sumo uno por comprobante). */
  vigentesDe(
    empresa: EmpresaId,
    comprobanteIds: readonly string[],
  ): Promise<readonly PagoGuardado[]>;
  /** Todos los pagos del comprobante (vigente y anulados), del más viejo al más nuevo. */
  deComprobante(empresa: EmpresaId, comprobanteId: string): Promise<readonly PagoGuardado[]>;
  insertar(empresa: EmpresaId, alta: AltaDePago): Promise<string | undefined>;
  /** `false` si ya no estaba VIGENTE. */
  anular(
    empresa: EmpresaId,
    id: string,
    anulacion: Readonly<{ por: PersonaId; en: Date; motivo: string }>,
  ): Promise<boolean>;
}

const COLUMNAS = [
  "id",
  "comprobante_id",
  "medio",
  "estado",
  "clave_idempotencia",
  "huella",
  "registrado_por",
  "registrado_en",
  "anulado_por",
  "anulado_en",
  "motivo_de_anulacion",
  "version",
  sql<string>`fecha_de_pago::text`.as("fecha_de_pago"),
  sql<string>`importe::text`.as("importe"),
] as const;

type Fila = {
  id: string;
  comprobante_id: string;
  fecha_de_pago: string;
  medio: string;
  importe: string;
  estado: string;
  clave_idempotencia: string;
  huella: string;
  registrado_por: string;
  registrado_en: Date;
  anulado_por: string | null;
  anulado_en: Date | null;
  motivo_de_anulacion: string | null;
  version: number;
};

function aPago(f: Fila): PagoGuardado {
  if (!esMedioDePago(f.medio)) throw new RangeError(`medio de pago desconocido: ${f.medio}`);
  if (f.estado !== "VIGENTE" && f.estado !== "ANULADO") {
    throw new RangeError(`estado de pago desconocido: ${f.estado}`);
  }
  return {
    id: f.id,
    comprobanteId: f.comprobante_id,
    fechaDePago: f.fecha_de_pago,
    medio: f.medio,
    importe: f.importe,
    estado: f.estado,
    claveIdempotencia: f.clave_idempotencia,
    huella: f.huella,
    registradoPor: f.registrado_por,
    registradoEn: f.registrado_en,
    anuladoPor: f.anulado_por,
    anuladoEn: f.anulado_en,
    motivoDeAnulacion: f.motivo_de_anulacion,
    version: f.version,
  };
}

export function crearRepositorioDePagos(db: Kysely<ComprasDb>): RepositorioDePagos {
  async function leer(empresa: EmpresaId, id: string, bloquear: boolean) {
    if (!esUuid(id)) return null;
    let consulta = db
      .selectFrom("pago_de_comprobante")
      .select(COLUMNAS)
      .where("empresa_id", "=", empresa)
      .where("id", "=", id);
    if (bloquear) consulta = consulta.forUpdate();
    const fila = await consulta.executeTakeFirst();
    return fila === undefined ? null : aPago(fila);
  }
  return {
    async porClave(empresa, clave) {
      const fila = await db
        .selectFrom("pago_de_comprobante")
        .select(COLUMNAS)
        .where("empresa_id", "=", empresa)
        .where("clave_idempotencia", "=", clave)
        .executeTakeFirst();
      return fila === undefined ? null : aPago(fila);
    },
    obtener: (empresa, id) => leer(empresa, id, false),
    bloquear: (empresa, id) => leer(empresa, id, true),
    async vigenteDe(empresa, comprobanteId) {
      if (!esUuid(comprobanteId)) return null;
      const fila = await db
        .selectFrom("pago_de_comprobante")
        .select(COLUMNAS)
        .where("empresa_id", "=", empresa)
        .where("comprobante_id", "=", comprobanteId)
        .where("estado", "=", "VIGENTE")
        .executeTakeFirst();
      return fila === undefined ? null : aPago(fila);
    },
    async vigentesDe(empresa, comprobanteIds) {
      const ids = comprobanteIds.filter(esUuid);
      if (ids.length === 0) return [];
      const filas = await db
        .selectFrom("pago_de_comprobante")
        .select(COLUMNAS)
        .where("empresa_id", "=", empresa)
        .where("comprobante_id", "in", ids)
        .where("estado", "=", "VIGENTE")
        .execute();
      return filas.map(aPago);
    },
    async deComprobante(empresa, comprobanteId) {
      if (!esUuid(comprobanteId)) return [];
      const filas = await db
        .selectFrom("pago_de_comprobante")
        .select(COLUMNAS)
        .where("empresa_id", "=", empresa)
        .where("comprobante_id", "=", comprobanteId)
        .orderBy("registrado_en")
        .orderBy("id")
        .execute();
      return filas.map(aPago);
    },
    async insertar(empresa, alta) {
      const fila = await db
        .insertInto("pago_de_comprobante")
        .values({
          empresa_id: empresa,
          comprobante_id: alta.comprobanteId,
          fecha_de_pago: alta.fechaDePago,
          medio: alta.medio,
          importe: alta.importe,
          clave_idempotencia: alta.clave,
          huella: alta.huella,
          registrado_por: alta.registradoPor,
        })
        .onConflict((oc) => oc.doNothing())
        .returning("id")
        .executeTakeFirst();
      return fila?.id;
    },
    async anular(empresa, id, anulacion) {
      const fila = await db
        .updateTable("pago_de_comprobante")
        .set({
          estado: "ANULADO",
          anulado_por: anulacion.por,
          anulado_en: anulacion.en,
          motivo_de_anulacion: anulacion.motivo,
        })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("estado", "=", "VIGENTE")
        .returning("id")
        .executeTakeFirst();
      return fila !== undefined;
    },
  };
}
