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

export type PropuestaDeConciliacion = Readonly<{ asignaciones: readonly AsignacionPedida[] }>;

/**
 * La propuesta de un toque para conciliar una factura de N3 o N4 (E9 §3.8): cada línea de la factura toma, por producto y en el orden en que se recibió, lo que haya sin
 * asignar en las recepciones CONFIRMADAS del mismo proveedor (las líneas rechazadas no se proponen). Solo propone: no escribe; la persona la confirma con `conciliarFactura`.
 * `null` si la factura no existe, no es de N3 o N4, está anulada o es de otra empresa (indistinguible).
 */
export async function proponerConciliacionDentro(
  tx: TxDeConsultasDeCompras,
  contexto: Pick<ContextoOperativo, "empresaId">,
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
  const lineas = await tx.detalleDeComprobantes.lineasDe(contexto.empresaId, comprobante.id);
  const saldos = await tx.conciliacionesDeCompra.saldosDeFactura(
    contexto.empresaId,
    comprobante.id,
  );
  const facturadas: LineaFacturadaPendiente[] = [];
  for (const l of lineas) {
    const saldo = saldos.find((s) => s.linea === l.numero);
    const pendiente =
      saldo === undefined ? null : pendienteDeLinea(saldo.facturada, saldo.asignada);
    if (l.productoId === null || l.productoId === undefined || pendiente === null) continue;
    facturadas.push({ numero: l.numero, productoId: l.productoId, sinConciliar: pendiente });
  }
  const disponibles: LineaRecibidaDisponible[] = [];
  for (const r of await tx.recepcionesSeparadas.lineasConciliables(
    contexto.empresaId,
    comprobante.proveedorId,
  )) {
    const sinAsignar = pendienteDeLinea(r.recibida, r.asignada);
    if (sinAsignar === null) continue;
    disponibles.push({
      recepcionId: r.recepcionId,
      linea: r.linea,
      productoId: r.productoId,
      sinAsignar,
    });
  }
  return { asignaciones: proponerAsignaciones(facturadas, disponibles) };
}
