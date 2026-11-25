import { sql, type Kysely } from "kysely";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import type { Remito } from "../dominio/registrar-compra";
import type { ComprasDb } from "./esquema";

export type FiltroDeListaSeparada = Readonly<{
  /** `TODAS` o las sucursales del alcance del actor; una lista vacía no ve nada. */
  sucursales: "TODAS" | readonly string[];
  proveedorId: string | null;
  /** Solo la recepción con este id (la ficha la lee con el mismo cálculo de saldos que la lista); ausente o `null`, sin este filtro. Solo lo usa `recepciones`. */
  recepcionId?: string | null;
  /** Solo la factura con este id (el detalle la lee con el mismo cálculo de saldos que la lista); ausente o `null`, sin este filtro. Solo lo usa `facturas`. */
  comprobanteId?: string | null;
  /** Fechas de negocio, `YYYY-MM-DD`, ambas inclusive. */
  desde: string | null;
  hasta: string | null;
  despuesDe: Readonly<{ fechaNegocio: string; id: string }> | null;
  limite: number;
}>;

export type FilaDeRecepcionSeparada = Readonly<{
  id: string;
  numero: number;
  sucursalId: string;
  proveedorId: string;
  fechaNegocio: string;
  remito: Remito | null;
  estado: "PENDIENTE" | "CONFIRMADA" | "ANULADA";
  /** Lo recibido sin las líneas que el control dejó RECHAZADAS, y lo ya asignado de eso (decimales de 4). */
  recibida: string;
  asignada: string;
}>;

export type FilaDeFacturaSeparada = Readonly<{
  id: string;
  proveedorId: string;
  tipo: string | null;
  puntoDeVenta: number | null;
  numero: number | null;
  fechaNegocio: string;
  estado: "REGISTRADO" | "ANULADO";
  totalSegunFactura: string;
  facturada: string;
  asignada: string;
  /** Hay mercadería CONFIRMADA del mismo proveedor y de algún producto de la factura, sin asignar y sin rechazar, en las sucursales del alcance que pidió (para «Falta conciliar»). */
  haySinConciliar: boolean;
}>;

/**
 * Lo que las pantallas leen de N3 y N4 (E9 §3.10): las recepciones con cuánto de lo recibido ya se concilió y las facturas con cuánto de lo facturado ya se concilió.
 * Solo lecturas; el estado lo deriva el dominio. Las facturas del atajo de N1 y N2 no aparecen (sus compras salen en el listado de compras).
 */
export interface RepositorioDeLecturasSeparadas {
  recepciones(
    empresa: EmpresaId,
    filtro: FiltroDeListaSeparada,
  ): Promise<readonly FilaDeRecepcionSeparada[]>;
  facturas(
    empresa: EmpresaId,
    filtro: FiltroDeListaSeparada,
  ): Promise<readonly FilaDeFacturaSeparada[]>;
}

const aEstadoDeRecepcion = (t: string): FilaDeRecepcionSeparada["estado"] => {
  if (t !== "PENDIENTE" && t !== "CONFIRMADA" && t !== "ANULADA") {
    throw new RangeError(`estado de recepción desconocido: ${t}`);
  }
  return t;
};
const aEstadoDeFactura = (t: string): FilaDeFacturaSeparada["estado"] => {
  if (t !== "REGISTRADO" && t !== "ANULADO")
    throw new RangeError(`estado de comprobante desconocido: ${t}`);
  return t;
};

export function crearRepositorioDeLecturasSeparadas(
  db: Kysely<ComprasDb>,
): RepositorioDeLecturasSeparadas {
  return {
    async recepciones(empresa, filtro) {
      if (filtro.sucursales !== "TODAS" && filtro.sucursales.length === 0) return [];
      let consulta = db
        .selectFrom("recepcion as r")
        .select([
          "r.id",
          "r.numero",
          "r.sucursal_id",
          "r.proveedor_id",
          "r.estado",
          "r.remito_punto_de_venta",
          "r.remito_numero",
          sql<string>`r.fecha_negocio::text`.as("fecha_negocio"),
          sql<string | null>`r.remito_fecha::text`.as("remito_fecha"),
          sql<string>`coalesce((select sum(s.cantidad_recibida) from saldo_de_linea_de_recepcion s
            where s.empresa_id = r.empresa_id and s.recepcion_id = r.id
              and not exists (select 1 from inspeccion_de_linea_de_recepcion i
                where i.empresa_id = s.empresa_id and i.recepcion_id = s.recepcion_id and i.linea = s.numero and i.condicion = 'RECHAZADA')), 0)::numeric(18,4)::text`.as(
            "recibida",
          ),
          sql<string>`coalesce((select sum(s.cantidad_asignada) from saldo_de_linea_de_recepcion s
            where s.empresa_id = r.empresa_id and s.recepcion_id = r.id), 0)::numeric(18,4)::text`.as(
            "asignada",
          ),
        ])
        .where("r.empresa_id", "=", empresa)
        .where("r.nivel", "in", ["RECEPCION_SEPARADA", "TRES_VIAS"]);
      if (filtro.sucursales !== "TODAS")
        consulta = consulta.where("r.sucursal_id", "in", [...filtro.sucursales]);
      if (filtro.proveedorId !== null)
        consulta = consulta.where("r.proveedor_id", "=", filtro.proveedorId);
      if (filtro.recepcionId !== undefined && filtro.recepcionId !== null)
        consulta = consulta.where("r.id", "=", filtro.recepcionId);
      if (filtro.desde !== null)
        consulta = consulta.where(sql`r.fecha_negocio`, ">=", sql`${filtro.desde}::date`);
      if (filtro.hasta !== null)
        consulta = consulta.where(sql`r.fecha_negocio`, "<=", sql`${filtro.hasta}::date`);
      if (filtro.despuesDe !== null) {
        const c = filtro.despuesDe;
        consulta = consulta.where(
          sql<boolean>`(r.fecha_negocio, r.id) < (${c.fechaNegocio}::date, ${c.id}::uuid)`,
        );
      }
      const filas = await consulta
        .orderBy(sql`r.fecha_negocio`, "desc")
        .orderBy("r.id", "desc")
        .limit(filtro.limite)
        .execute();
      return filas.map((f) => ({
        id: f.id,
        numero: f.numero,
        sucursalId: f.sucursal_id,
        proveedorId: f.proveedor_id,
        fechaNegocio: f.fecha_negocio,
        remito:
          f.remito_punto_de_venta === null || f.remito_numero === null || f.remito_fecha === null
            ? null
            : {
                puntoDeVenta: f.remito_punto_de_venta,
                numero: f.remito_numero,
                fecha: f.remito_fecha,
              },
        estado: aEstadoDeRecepcion(f.estado),
        recibida: f.recibida,
        asignada: f.asignada,
      }));
    },
    async facturas(empresa, filtro) {
      // La factura no tiene sucursal: ve todas las del proveedor quien tiene alcance sobre alguna sucursal (el alcance vacío no ve nada).
      if (filtro.sucursales !== "TODAS" && filtro.sucursales.length === 0) return [];
      // «Falta conciliar» mira solo la mercadería de las sucursales del alcance de quien pide (cada gerente concilia lo de su sucursal).
      const alcance =
        filtro.sucursales === "TODAS"
          ? sql`true`
          : sql`r.sucursal_id in (${sql.join(filtro.sucursales.map((id) => sql`${id}::uuid`))})`;
      let consulta = db
        .selectFrom("comprobante_de_proveedor as c")
        .select([
          "c.id",
          "c.proveedor_id",
          "c.tipo",
          "c.punto_de_venta",
          "c.numero",
          "c.estado",
          sql<string>`c.fecha_negocio::text`.as("fecha_negocio"),
          sql<string>`c.total_segun_factura::text`.as("total_segun_factura"),
          sql<string>`coalesce((select sum(s.cantidad_facturada) from saldo_de_linea_de_comprobante s
            where s.empresa_id = c.empresa_id and s.comprobante_id = c.id), 0)::numeric(18,4)::text`.as(
            "facturada",
          ),
          sql<string>`coalesce((select sum(s.cantidad_asignada) from saldo_de_linea_de_comprobante s
            where s.empresa_id = c.empresa_id and s.comprobante_id = c.id), 0)::numeric(18,4)::text`.as(
            "asignada",
          ),
          sql<boolean>`exists (select 1 from linea_de_comprobante lc
            join linea_de_recepcion l on l.empresa_id = lc.empresa_id and l.producto_id = lc.producto_id
            join recepcion r on r.empresa_id = l.empresa_id and r.id = l.recepcion_id
            join saldo_de_linea_de_recepcion s on s.empresa_id = l.empresa_id and s.recepcion_id = l.recepcion_id and s.numero = l.numero
            where lc.empresa_id = c.empresa_id and lc.comprobante_id = c.id
              and r.proveedor_id = c.proveedor_id and r.estado = 'CONFIRMADA'
              and r.nivel in ('RECEPCION_SEPARADA', 'TRES_VIAS')
              and s.cantidad_recibida > s.cantidad_asignada
              and not exists (select 1 from inspeccion_de_linea_de_recepcion i
                where i.empresa_id = l.empresa_id and i.recepcion_id = l.recepcion_id and i.linea = l.numero and i.condicion = 'RECHAZADA')
              and ${alcance})`.as("hay_sin_conciliar"),
        ])
        .where("c.empresa_id", "=", empresa)
        .where("c.clase", "=", "FACTURA")
        .where("c.nivel", "in", ["RECEPCION_SEPARADA", "TRES_VIAS"])
        .where("c.es_atajo", "=", false);
      if (filtro.proveedorId !== null)
        consulta = consulta.where("c.proveedor_id", "=", filtro.proveedorId);
      if (filtro.comprobanteId !== undefined && filtro.comprobanteId !== null)
        consulta = consulta.where("c.id", "=", filtro.comprobanteId);
      if (filtro.desde !== null)
        consulta = consulta.where(sql`c.fecha_negocio`, ">=", sql`${filtro.desde}::date`);
      if (filtro.hasta !== null)
        consulta = consulta.where(sql`c.fecha_negocio`, "<=", sql`${filtro.hasta}::date`);
      if (filtro.despuesDe !== null) {
        const c = filtro.despuesDe;
        consulta = consulta.where(
          sql<boolean>`(c.fecha_negocio, c.id) < (${c.fechaNegocio}::date, ${c.id}::uuid)`,
        );
      }
      const filas = await consulta
        .orderBy(sql`c.fecha_negocio`, "desc")
        .orderBy("c.id", "desc")
        .limit(filtro.limite)
        .execute();
      return filas.map((f) => ({
        id: f.id,
        proveedorId: f.proveedor_id,
        tipo: f.tipo,
        puntoDeVenta: f.punto_de_venta,
        numero: f.numero,
        fechaNegocio: f.fecha_negocio,
        estado: aEstadoDeFactura(f.estado),
        totalSegunFactura: f.total_segun_factura,
        facturada: f.facturada,
        asignada: f.asignada,
        haySinConciliar: f.hay_sin_conciliar,
      }));
    },
  };
}
