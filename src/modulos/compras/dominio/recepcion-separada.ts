import type { ControlDeLinea } from "./control-de-recepcion";
import type { VinculoDeOrden } from "./orden-de-compra";
import { leerCantidad } from "./decimal";
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
  /** Contra qué líneas de qué órdenes se recibe (N4); vacío o ausente si no es contra una orden (la huella no cambia). */
  vinculos?: readonly VinculoDeOrden[];
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
  const vinculos = [...(pedido.vinculos ?? [])]
    .sort((a, b) => a.linea - b.linea)
    .map((v) => [v.linea, v.ordenId, v.lineaDeOrden, v.confirmoExceso]);
  return huellaDeComando(
    "registrar_recepcion",
    [
      pedido.sucursalId,
      pedido.proveedorId,
      pedido.hechoEn,
      ...remito,
      JSON.stringify(controles),
      ...(vinculos.length === 0 ? [] : [JSON.stringify(vinculos)]),
    ],
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

/**
 * El estado DERIVADO de una recepción de N3 o N4 (S-12: no se guarda): `PENDIENTE_DE_CONFIRMAR` (todavía no entró el stock), `ANULADA`, y, confirmada, cuánto de lo
 * recibido (sin las líneas rechazadas) ya se concilió con facturas: nada → `RECIBIDA_SIN_FACTURAR`, todo → `RECIBIDA_Y_FACTURADA`, algo → `FACTURADA_EN_PARTE`. Los dos
 * primeros de la conciliación son los textos aprobados de la maqueta; `FACTURADA_EN_PARTE` y `PENDIENTE_DE_CONFIRMAR` son códigos: su texto lo decide la pantalla.
 * Lo recibido o lo asignado que no es un decimal válido no cuenta como facturado (falla cerrada hacia «sin facturar»).
 */
export type EstadoDeRecepcionSeparada =
  | "PENDIENTE_DE_CONFIRMAR"
  | "ANULADA"
  | "RECIBIDA_SIN_FACTURAR"
  | "FACTURADA_EN_PARTE"
  | "RECIBIDA_Y_FACTURADA";

export function estadoDeRecepcionSeparada(
  estado: "PENDIENTE" | "CONFIRMADA" | "ANULADA",
  recibida: string,
  asignada: string,
): EstadoDeRecepcionSeparada {
  if (estado === "ANULADA") return "ANULADA";
  if (estado === "PENDIENTE") return "PENDIENTE_DE_CONFIRMAR";
  const total = leerCantidad(recibida);
  const hecha = leerCantidad(asignada);
  if (total === null || hecha === null || hecha === 0n) return "RECIBIDA_SIN_FACTURAR";
  return hecha >= total ? "RECIBIDA_Y_FACTURADA" : "FACTURADA_EN_PARTE";
}

/**
 * El estado derivado de una factura de N3 o N4: `ANULADA`, y, registrada, cuánto de lo facturado ya se concilió con lo recibido: nada conciliado y NADA recibido todavía de sus productos →
 * `FACTURADA_FALTA_RECIBIR` («Facturada, falta recibir», aprobado en la maqueta); nada conciliado pero ya hay mercadería recibida sin repartir → `FALTA_CONCILIAR` («Falta conciliar»,
 * aprobado por el dueño el 25/11/2026); algo → `CONCILIADA_EN_PARTE` («Conciliada en parte», aprobado por el dueño); todo → `CONCILIADA` («Todo coincide»).
 * `haySinConciliar` es lo que lee la lista (hay recibido CONFIRMADO del mismo proveedor y de los productos de la factura sin asignar, dentro del alcance de quien mira); sin dato, falla hacia «falta recibir».
 */
export type EstadoDeFacturaSeparada =
  "ANULADA" | "FACTURADA_FALTA_RECIBIR" | "FALTA_CONCILIAR" | "CONCILIADA_EN_PARTE" | "CONCILIADA";

export function estadoDeFacturaSeparada(
  estado: "REGISTRADO" | "ANULADO",
  facturada: string,
  asignada: string,
  haySinConciliar = false,
): EstadoDeFacturaSeparada {
  if (estado === "ANULADO") return "ANULADA";
  const total = leerCantidad(facturada);
  const hecha = leerCantidad(asignada);
  if (total === null || hecha === null || hecha === 0n) {
    return haySinConciliar && total !== null && hecha !== null
      ? "FALTA_CONCILIAR"
      : "FACTURADA_FALTA_RECIBIR";
  }
  return hecha >= total ? "CONCILIADA" : "CONCILIADA_EN_PARTE";
}
