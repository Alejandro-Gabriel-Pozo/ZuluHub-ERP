import { sql, type Kysely } from "kysely";
import type { EmpresaId, PersonaId } from "../../../primitivas/identificadores/marca";
import {
  esTipoDeComprobanteDeProveedor,
  type TipoDeComprobanteDeProveedor,
} from "../dominio/comprobante";
import { esNivelDeCompra, type NivelDeCompra } from "../dominio/niveles";
import type { ComprasDb } from "./esquema";
import { esUuid } from "./filas";

export type EstadoDeComprobante = "REGISTRADO" | "ANULADO";

export type ComprobanteGuardado = Readonly<{
  id: string;
  proveedorId: string;
  clase: string;
  tipo: TipoDeComprobanteDeProveedor | null;
  puntoDeVenta: number | null;
  numero: number | null;
  fechaDelComprobante: string | null;
  fechaDeVencimientoDePago: string | null;
  netoGravado: string;
  noGravado: string;
  exento: string;
  iva: string;
  tributosTotal: string;
  creditoFiscalComputable: string;
  totalCalculado: string;
  totalSegunFactura: string;
  proveedorCuit: string | null;
  proveedorRazonSocial: string;
  letraNoEsperada: boolean;
  nivel: NivelDeCompra;
  esAtajo: boolean;
  estado: EstadoDeComprobante;
  fechaNegocio: string;
  claveIdempotencia: string;
  huella: string;
  registradoPor: string;
  anuladoPor: string | null;
  anuladoEn: Date | null;
  motivoDeAnulacion: string | null;
  version: number;
}>;

export type AltaDeComprobante = Readonly<{
  proveedorId: string;
  clase: string;
  tipo: TipoDeComprobanteDeProveedor;
  puntoDeVenta: number;
  numero: number;
  fechaDelComprobante: string;
  fechaDeVencimientoDePago: string | null;
  netoGravado: string;
  noGravado: string;
  exento: string;
  iva: string;
  tributosTotal: string;
  creditoFiscalComputable: string;
  totalCalculado: string;
  totalSegunFactura: string;
  proveedorCuit: string | null;
  proveedorRazonSocial: string;
  letraNoEsperada: boolean;
  nivel: NivelDeCompra;
  esAtajo: boolean;
  clave: string;
  huella: string;
  registradoPor: PersonaId;
}>;

/**
 * Los comprobantes de proveedor (E9 §3.3). El alta usa `ON CONFLICT DO NOTHING` sin objetivo (cubre la clave y el duplicado único): devuelve `undefined` si chocó;
 * quien llama ya buscó antes (`porClave`, `porDuplicado`) y decide qué fue. Las líneas, los importes y los tributos solo entran en la transacción de su cabecera
 * (disparador) y no se tocan; los saldos los escribe la base. Lo único que cambia de un comprobante es su anulación. La conciliación atajo y sus asignaciones se
 * escriben acá también: la anulación es otro acto que la refleja con las cantidades opuestas, una sola vez.
 */
export interface RepositorioDeComprobantes {
  porClave(empresa: EmpresaId, clave: string): Promise<ComprobanteGuardado | null>;
  /** El comprobante NO anulado de ese proveedor con ese tipo, punto de venta y número (el anulado libera el número). */
  porDuplicado(
    empresa: EmpresaId,
    proveedorId: string,
    tipo: TipoDeComprobanteDeProveedor,
    puntoDeVenta: number,
    numero: number,
  ): Promise<ComprobanteGuardado | null>;
  obtener(empresa: EmpresaId, id: string): Promise<ComprobanteGuardado | null>;
  bloquear(empresa: EmpresaId, id: string): Promise<ComprobanteGuardado | null>;
  /** El comprobante vigente (registrado si lo hay; si no, el más nuevo) de una recepción, por el puntero de sus líneas. */
  delaRecepcion(empresa: EmpresaId, recepcionId: string): Promise<ComprobanteGuardado | null>;
  /** Los comprobantes de un proveedor, los más nuevos primero (hasta `limite`). */
  delProveedor(
    empresa: EmpresaId,
    proveedorId: string,
    limite: number,
  ): Promise<readonly ComprobanteGuardado[]>;
  /** La recepción a la que apuntan las líneas del comprobante (en N1 y N2, una sola), o `null` si no apunta a ninguna. */
  recepcionIdDe(empresa: EmpresaId, comprobanteId: string): Promise<string | null>;
  insertar(empresa: EmpresaId, alta: AltaDeComprobante): Promise<string | undefined>;
  /** `false` si ya no estaba REGISTRADO. */
  anular(
    empresa: EmpresaId,
    id: string,
    anulacion: Readonly<{ por: PersonaId; en: Date; motivo: string }>,
  ): Promise<boolean>;
}

const COLUMNAS = [
  "id",
  "proveedor_id",
  "clase",
  "tipo",
  "punto_de_venta",
  "numero",
  "neto_gravado",
  "no_gravado",
  "exento",
  "iva",
  "tributos_total",
  "credito_fiscal_computable",
  "total_calculado",
  "total_segun_factura",
  "proveedor_cuit",
  "proveedor_razon_social",
  "letra_no_esperada",
  "nivel",
  "es_atajo",
  "estado",
  "clave_idempotencia",
  "huella",
  "registrado_por",
  "anulado_por",
  "anulado_en",
  "motivo_de_anulacion",
  "version",
  sql<string | null>`fecha_del_comprobante::text`.as("fecha_del_comprobante"),
  sql<string | null>`fecha_de_vencimiento_de_pago::text`.as("fecha_de_vencimiento_de_pago"),
  sql<string>`fecha_negocio::text`.as("fecha_negocio"),
] as const;

type Fila = {
  id: string;
  proveedor_id: string;
  clase: string;
  tipo: string | null;
  punto_de_venta: number | null;
  numero: number | null;
  fecha_del_comprobante: string | null;
  fecha_de_vencimiento_de_pago: string | null;
  neto_gravado: string;
  no_gravado: string;
  exento: string;
  iva: string;
  tributos_total: string;
  credito_fiscal_computable: string;
  total_calculado: string;
  total_segun_factura: string;
  proveedor_cuit: string | null;
  proveedor_razon_social: string;
  letra_no_esperada: boolean;
  nivel: string;
  es_atajo: boolean;
  estado: string;
  fecha_negocio: string;
  clave_idempotencia: string;
  huella: string;
  registrado_por: string;
  anulado_por: string | null;
  anulado_en: Date | null;
  motivo_de_anulacion: string | null;
  version: number;
};

function aComprobante(f: Fila): ComprobanteGuardado {
  if (!esNivelDeCompra(f.nivel)) throw new RangeError(`nivel de compra desconocido: ${f.nivel}`);
  if (f.estado !== "REGISTRADO" && f.estado !== "ANULADO") {
    throw new RangeError(`estado de comprobante desconocido: ${f.estado}`);
  }
  if (f.tipo !== null && !esTipoDeComprobanteDeProveedor(f.tipo)) {
    throw new RangeError(`tipo de comprobante desconocido: ${f.tipo}`);
  }
  return {
    id: f.id,
    proveedorId: f.proveedor_id,
    clase: f.clase,
    tipo: f.tipo,
    puntoDeVenta: f.punto_de_venta,
    numero: f.numero,
    fechaDelComprobante: f.fecha_del_comprobante,
    fechaDeVencimientoDePago: f.fecha_de_vencimiento_de_pago,
    netoGravado: f.neto_gravado,
    noGravado: f.no_gravado,
    exento: f.exento,
    iva: f.iva,
    tributosTotal: f.tributos_total,
    creditoFiscalComputable: f.credito_fiscal_computable,
    totalCalculado: f.total_calculado,
    totalSegunFactura: f.total_segun_factura,
    proveedorCuit: f.proveedor_cuit,
    proveedorRazonSocial: f.proveedor_razon_social,
    letraNoEsperada: f.letra_no_esperada,
    nivel: f.nivel,
    esAtajo: f.es_atajo,
    estado: f.estado,
    fechaNegocio: f.fecha_negocio,
    claveIdempotencia: f.clave_idempotencia,
    huella: f.huella,
    registradoPor: f.registrado_por,
    anuladoPor: f.anulado_por,
    anuladoEn: f.anulado_en,
    motivoDeAnulacion: f.motivo_de_anulacion,
    version: f.version,
  };
}

export function crearRepositorioDeComprobantes(db: Kysely<ComprasDb>): RepositorioDeComprobantes {
  async function leer(empresa: EmpresaId, id: string, bloquear: boolean) {
    if (!esUuid(id)) return null;
    let consulta = db
      .selectFrom("comprobante_de_proveedor")
      .select(COLUMNAS)
      .where("empresa_id", "=", empresa)
      .where("id", "=", id);
    if (bloquear) consulta = consulta.forUpdate();
    const fila = await consulta.executeTakeFirst();
    return fila === undefined ? null : aComprobante(fila);
  }
  return {
    async porClave(empresa, clave) {
      const fila = await db
        .selectFrom("comprobante_de_proveedor")
        .select(COLUMNAS)
        .where("empresa_id", "=", empresa)
        .where("clave_idempotencia", "=", clave)
        .executeTakeFirst();
      return fila === undefined ? null : aComprobante(fila);
    },
    async porDuplicado(empresa, proveedorId, tipo, puntoDeVenta, numero) {
      const fila = await db
        .selectFrom("comprobante_de_proveedor")
        .select(COLUMNAS)
        .where("empresa_id", "=", empresa)
        .where("proveedor_id", "=", proveedorId)
        .where("tipo", "=", tipo)
        .where("punto_de_venta", "=", puntoDeVenta)
        .where("numero", "=", numero)
        .where("estado", "<>", "ANULADO")
        .executeTakeFirst();
      return fila === undefined ? null : aComprobante(fila);
    },
    obtener: (empresa, id) => leer(empresa, id, false),
    bloquear: (empresa, id) => leer(empresa, id, true),
    async delaRecepcion(empresa, recepcionId) {
      if (!esUuid(recepcionId)) return null;
      const fila = await db
        .selectFrom("comprobante_de_proveedor")
        .select(COLUMNAS)
        .where("empresa_id", "=", empresa)
        .where(
          sql<boolean>`id in (select l.comprobante_id from linea_de_comprobante l where l.empresa_id = ${empresa} and l.recepcion_id = ${recepcionId})`,
        )
        .orderBy(sql`(estado = 'REGISTRADO')`, "desc")
        .orderBy("registrado_en", "desc")
        .limit(1)
        .executeTakeFirst();
      return fila === undefined ? null : aComprobante(fila);
    },
    async delProveedor(empresa, proveedorId, limite) {
      if (!esUuid(proveedorId)) return [];
      const filas = await db
        .selectFrom("comprobante_de_proveedor")
        .select(COLUMNAS)
        .where("empresa_id", "=", empresa)
        .where("proveedor_id", "=", proveedorId)
        .orderBy(sql`fecha_negocio`, "desc")
        .orderBy("registrado_en", "desc")
        .orderBy("id", "desc")
        .limit(limite)
        .execute();
      return filas.map(aComprobante);
    },
    async recepcionIdDe(empresa, comprobanteId) {
      if (!esUuid(comprobanteId)) return null;
      const fila = await db
        .selectFrom("linea_de_comprobante")
        .select("recepcion_id")
        .where("empresa_id", "=", empresa)
        .where("comprobante_id", "=", comprobanteId)
        .where("recepcion_id", "is not", null)
        .orderBy("numero")
        .limit(1)
        .executeTakeFirst();
      return fila?.recepcion_id ?? null;
    },
    async insertar(empresa, alta) {
      const fila = await db
        .insertInto("comprobante_de_proveedor")
        .values({
          empresa_id: empresa,
          proveedor_id: alta.proveedorId,
          clase: alta.clase,
          tipo: alta.tipo,
          punto_de_venta: alta.puntoDeVenta,
          numero: alta.numero,
          fecha_del_comprobante: alta.fechaDelComprobante,
          fecha_de_vencimiento_de_pago: alta.fechaDeVencimientoDePago,
          neto_gravado: alta.netoGravado,
          no_gravado: alta.noGravado,
          exento: alta.exento,
          iva: alta.iva,
          tributos_total: alta.tributosTotal,
          credito_fiscal_computable: alta.creditoFiscalComputable,
          total_calculado: alta.totalCalculado,
          total_segun_factura: alta.totalSegunFactura,
          proveedor_cuit: alta.proveedorCuit,
          proveedor_razon_social: alta.proveedorRazonSocial,
          letra_no_esperada: alta.letraNoEsperada,
          nivel: alta.nivel,
          es_atajo: alta.esAtajo,
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
        .updateTable("comprobante_de_proveedor")
        .set({
          estado: "ANULADO",
          anulado_por: anulacion.por,
          anulado_en: anulacion.en,
          motivo_de_anulacion: anulacion.motivo,
        })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("estado", "=", "REGISTRADO")
        .returning("id")
        .executeTakeFirst();
      return fila !== undefined;
    },
  };
}
