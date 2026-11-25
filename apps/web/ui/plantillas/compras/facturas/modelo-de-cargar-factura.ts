import type { FacturaEscrita } from "../nueva/modelo-de-factura";
import { facturaParaElServidor } from "../nueva/modelo-de-factura";
import type { RenglonCotizado, RenglonEscrito } from "../nueva/modelo-de-nueva-compra";

/**
 * El pedido de «Cargar factura» (Compras 4, la factura de la empresa): lo mismo que la factura de «Nueva compra» (`facturaParaElServidor`: tipo, punto de venta, número, fecha, vencimiento, líneas con cantidad
 * facturada, precio neto y alícuota, percepciones, total según la factura, CUIT del proveedor nuevo), pero cada línea dice su PRODUCTO (con él se propone la conciliación) y NO hay sucursal, remito ni depósito:
 * la factura es de la empresa. Puro: sin React ni servidor, y sin ninguna cuenta (las hace el servidor). `null` mientras falta algo (el botón queda apagado).
 */
export type PedidoDeFactura = Readonly<{ proveedorId: string; factura: unknown }>;

export function armarElPedidoDeFactura(
  proveedorId: string,
  factura: FacturaEscrita,
  renglones: readonly RenglonEscrito[],
  pideCuit: boolean,
): PedidoDeFactura | null {
  const completa = facturaParaElServidor(
    factura,
    renglones,
    new Map<string, RenglonCotizado>(),
    pideCuit,
  );
  if (completa === null) return null;
  return {
    proveedorId,
    factura: {
      ...completa,
      lineas: completa.lineas.map((l, i) => ({
        productoId: renglones[i]?.productoId ?? "",
        cantidadFacturada: l.cantidadFacturada,
        precioNeto: l.precioNeto,
        alicuota: l.alicuota,
      })),
    },
  };
}
