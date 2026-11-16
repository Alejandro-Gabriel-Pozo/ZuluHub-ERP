import type { ControlDeLinea } from "./control-de-recepcion";
import { huellaDeComando } from "./huella";
import type { NivelDeCompra } from "./niveles";
import type { Remito, RenglonDeCompra } from "./registrar-compra";

/**
 * La recepción separada (N3 y N4, E9 §3.8): la mercadería se recibe y queda PENDIENTE de confirmar; el stock entra recién al confirmarla. Pura: sin reloj ni azar.
 */

/** Solo las empresas en N3 o N4 reciben así; N1 y N2 reciben y entran stock en un solo paso (decisión del dueño, 14/11/2026, Q9). */
export const esNivelDeRecepcionSeparada = (nivel: NivelDeCompra): boolean =>
  nivel === "RECEPCION_SEPARADA" || nivel === "TRES_VIAS";

export type PedidoDeRecepcion = Readonly<{
  sucursalId: string;
  proveedorId: string;
  /** Lo que mandó la persona (`null` si no mandó nada: el `hechoEn` del contexto no entra a la huella o un reintento daría otra). */
  hechoEn: string | null;
  remito: Remito | null;
  renglones: readonly RenglonDeCompra[];
  controles: readonly ControlDeLinea[];
}>;

/**
 * La huella del pedido de recepción: con la clave de idempotencia decide si un reintento es el mismo pedido. Los renglones se ordenan antes de hashear; los
 * controles van ordenados por línea (cada uno es de una línea distinta) y entran completos: otro control, otro pedido.
 */
export function huellaDeLaRecepcion(pedido: PedidoDeRecepcion): string {
  const remito =
    pedido.remito === null
      ? [null, null, null]
      : [pedido.remito.puntoDeVenta, pedido.remito.numero, pedido.remito.fecha];
  const controles = [...pedido.controles]
    .sort((a, b) => a.linea - b.linea)
    .map((c) => [c.linea, c.condicion, c.cantidadSegunRemito, c.observacion, c.temperaturaEnC]);
  return huellaDeComando(
    "registrar_recepcion",
    [pedido.sucursalId, pedido.proveedorId, pedido.hechoEn, ...remito, JSON.stringify(controles)],
    pedido.renglones.map((r) => [
      r.productoId,
      r.presentacionId,
      r.unidadDeCompraId,
      r.cantidad,
      r.pesoReal,
      r.precioPor,
      r.unidadDePrecioId,
      r.precio,
    ]),
  );
}
