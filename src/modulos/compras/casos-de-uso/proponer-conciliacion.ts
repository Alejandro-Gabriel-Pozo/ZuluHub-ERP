import type { ContextoOperativo } from "../../../contexto/contexto";
import {
  pendienteDeLinea,
  proponerAsignaciones,
  type AsignacionPedida,
  type LineaFacturadaPendiente,
  type LineaRecibidaDisponible,
} from "../dominio/conciliacion-separada";
import { esUuid } from "../dominio/identificadores";
import { esNivelDeRecepcionSeparada } from "../dominio/recepcion-separada";
import type { TxDeConsultasDeCompras } from "./contrato";

/** Una línea de la factura con lo que todavía le falta conciliar (lo que la pantalla de conciliar reparte). */
export type LineaFacturadaParaConciliar = Readonly<{
  numero: number;
  productoId: string;
  productoNombre: string | null;
  /** La unidad de stock del producto (la base): en ella van las cantidades. */
  unidadDeStockId: string | null;
  facturada: string;
  /** Lo facturado menos lo ya conciliado (decimal de 4). */
  sinConciliar: string;
}>;

/** Una línea recibida (de una recepción CONFIRMADA de una sucursal del alcance) con lo que todavía no se asignó a ninguna factura. */
export type LineaRecibidaParaConciliar = Readonly<{
  recepcionId: string;
  recepcionNumero: number;
  sucursalId: string;
  linea: number;
  productoId: string;
  productoNombre: string | null;
  unidadDeStockId: string | null;
  recibida: string;
  /** Lo recibido menos lo ya asignado (decimal de 4). */
  sinAsignar: string;
}>;

export type PropuestaDeConciliacion = Readonly<{
  asignaciones: readonly AsignacionPedida[];
  lineas: readonly LineaFacturadaParaConciliar[];
  recibidas: readonly LineaRecibidaParaConciliar[];
}>;

/**
 * Lo que necesita la pantalla de conciliar una factura de N3 o N4 (E9 §3.8) y la propuesta de un toque: cada línea de la factura toma, por producto y en el orden en que se recibió, lo que haya sin asignar en las
 * recepciones CONFIRMADAS del mismo proveedor (las líneas rechazadas no se proponen). **Limitada al alcance de quien pide** (decisión del dueño, 25/11/2026, pregunta 6; hoy gerente y administrador tienen «TODAS», H6, así que el límite solo actúa con un alcance acotado): con alcance de
 * una sola sucursal, ni la propuesta ni la lista de lo recibido traen líneas de otras. Solo propone: no escribe; la persona la confirma con `conciliarFactura`, que vuelve a decidir todo (permiso, alcance, topes).
 * `null` si la factura no existe, no es de N3 o N4, está anulada o es de otra empresa (indistinguible).
 */
export async function proponerConciliacionDentro(
  tx: TxDeConsultasDeCompras,
  contexto: ContextoOperativo,
  entrada: Readonly<{ comprobanteId: string }>,
): Promise<PropuestaDeConciliacion | null> {
  if (!esUuid(entrada.comprobanteId)) return null;
  const comprobante = await tx.comprobantesDeProveedor.obtener(
    contexto.empresaId,
    entrada.comprobanteId,
  );
  if (
    comprobante === null ||
    comprobante.estado !== "REGISTRADO" ||
    comprobante.esAtajo ||
    !esNivelDeRecepcionSeparada(comprobante.nivel)
  ) {
    return null;
  }
  const alcance = await tx.autorizacion.sucursalesDelActor(contexto);
  const lineas = await tx.detalleDeComprobantes.lineasDe(contexto.empresaId, comprobante.id);
  const saldos = await tx.conciliacionesDeCompra.saldosDeFactura(
    contexto.empresaId,
    comprobante.id,
  );
  const recibidasDelAlcance = await tx.recepcionesSeparadas.lineasConciliables(
    contexto.empresaId,
    comprobante.proveedorId,
    alcance,
  );
  const productos = new Map(
    (
      await tx.productosParaCompras.deVarios(contexto.empresaId, [
        ...new Set([
          ...lineas.flatMap((l) =>
            l.productoId === null || l.productoId === undefined ? [] : [l.productoId],
          ),
          ...recibidasDelAlcance.map((r) => r.productoId),
        ]),
      ])
    ).map((p) => [p.id, p]),
  );
  const facturadas: LineaFacturadaPendiente[] = [];
  const paraMostrar: LineaFacturadaParaConciliar[] = [];
  for (const l of lineas) {
    const saldo = saldos.find((s) => s.linea === l.numero);
    const pendiente =
      saldo === undefined ? null : pendienteDeLinea(saldo.facturada, saldo.asignada);
    if (
      l.productoId === null ||
      l.productoId === undefined ||
      saldo === undefined ||
      pendiente === null
    )
      continue;
    facturadas.push({ numero: l.numero, productoId: l.productoId, sinConciliar: pendiente });
    paraMostrar.push({
      numero: l.numero,
      productoId: l.productoId,
      productoNombre: productos.get(l.productoId)?.nombre ?? null,
      unidadDeStockId: productos.get(l.productoId)?.unidadBaseId ?? null,
      facturada: saldo.facturada,
      sinConciliar: pendiente,
    });
  }
  const disponibles: LineaRecibidaDisponible[] = [];
  const recibidas: LineaRecibidaParaConciliar[] = [];
  for (const r of recibidasDelAlcance) {
    const sinAsignar = pendienteDeLinea(r.recibida, r.asignada);
    if (sinAsignar === null) continue;
    disponibles.push({
      recepcionId: r.recepcionId,
      linea: r.linea,
      productoId: r.productoId,
      sinAsignar,
    });
    recibidas.push({
      recepcionId: r.recepcionId,
      recepcionNumero: r.recepcionNumero,
      sucursalId: r.sucursalId,
      linea: r.linea,
      productoId: r.productoId,
      productoNombre: productos.get(r.productoId)?.nombre ?? null,
      unidadDeStockId: productos.get(r.productoId)?.unidadBaseId ?? null,
      recibida: r.recibida,
      sinAsignar,
    });
  }
  return {
    asignaciones: proponerAsignaciones(facturadas, disponibles),
    lineas: paraMostrar,
    recibidas,
  };
}
