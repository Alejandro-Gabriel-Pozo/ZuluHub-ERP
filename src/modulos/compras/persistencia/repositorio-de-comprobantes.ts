import { sql, type Kysely } from "kysely";
import type { EmpresaId, PersonaId } from "../../../primitivas/identificadores/marca";
import type { TipoDeComprobanteDeProveedor } from "../dominio/comprobante";
import type { NivelDeCompra } from "../dominio/niveles";
import type { ComprasDb } from "./esquema";
import { COLUMNAS, aComprobante, type ComprobanteGuardado } from "./comprobante-fila";
import { esUuid } from "./filas";

export type { ComprobanteGuardado, EstadoDeComprobante } from "./comprobante-fila";

export type AltaDeComprobante = Readonly<{
  proveedorId: string;
  clase: string;
  /** La factura que corrige: obligatoria en una nota de crédito y ausente en lo demás (lo exige la base). */
  comprobanteAsociadoId?: string | null;
  /** La factura anulada que la nueva reemplaza (solo una factura; la base exige que esté anulada y sea del mismo proveedor al confirmar). */
  reemplazaAId?: string | null;
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
  /** La factura VIGENTE que reemplaza a esta (la anulada), o `null`: a lo sumo una (lo impone la base). */
  reemplazoVigenteDe(
    empresa: EmpresaId,
    facturaId: string,
  ): Promise<Readonly<{ id: string }> | null>;
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
  /** Lo mismo que `delaRecepcion` para varias recepciones en UNA consulta (sin N+1): el comprobante vigente de cada una, con su recepción; las que no tienen no aparecen. */
  deVariasRecepciones(
    empresa: EmpresaId,
    recepcionIds: readonly string[],
  ): Promise<readonly (ComprobanteGuardado & Readonly<{ recepcionId: string }>)[]>;
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
    async reemplazoVigenteDe(empresa, facturaId) {
      const fila = await db
        .selectFrom("comprobante_de_proveedor")
        .select("id")
        .where("empresa_id", "=", empresa)
        .where("reemplaza_a_id", "=", facturaId)
        .where("estado", "=", "REGISTRADO")
        .executeTakeFirst();
      return fila === undefined ? null : { id: fila.id };
    },
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
    async deVariasRecepciones(empresa, recepcionIds) {
      const validos = [...new Set(recepcionIds.filter(esUuid))];
      if (validos.length === 0) return [];
      const apunta = sql<
        string | null
      >`(select l.recepcion_id from linea_de_comprobante l where l.empresa_id = comprobante_de_proveedor.empresa_id
        and l.comprobante_id = comprobante_de_proveedor.id and l.recepcion_id in (${sql.join(validos)}) limit 1)`;
      const filas = await db
        .selectFrom("comprobante_de_proveedor")
        .select([...COLUMNAS, apunta.as("recepcion_id")])
        .where("empresa_id", "=", empresa)
        .where(sql<boolean>`${apunta} is not null`)
        // El mismo criterio que `delaRecepcion`: el registrado primero y, entre iguales, el más nuevo; el primero de cada recepción es el vigente.
        .orderBy(sql`(estado = 'REGISTRADO')`, "desc")
        .orderBy("registrado_en", "desc")
        .execute();
      const vistas = new Set<string>();
      const vigentes: (ComprobanteGuardado & Readonly<{ recepcionId: string }>)[] = [];
      for (const f of filas) {
        if (f.recepcion_id === null || vistas.has(f.recepcion_id)) continue;
        vistas.add(f.recepcion_id);
        vigentes.push({ ...aComprobante(f), recepcionId: f.recepcion_id });
      }
      return vigentes;
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
          comprobante_asociado_id: alta.comprobanteAsociadoId ?? null,
          reemplaza_a_id: alta.reemplazaAId ?? null,
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
