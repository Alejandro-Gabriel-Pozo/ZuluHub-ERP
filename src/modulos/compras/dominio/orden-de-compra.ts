import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import {
  leerCantidadPositiva,
  leerPrecioPositivo,
  textoDeCantidad,
  textoDePrecio,
} from "./decimal";
import { esFechaCivil } from "./factura";
import { huellaDeComando } from "./huella";
import { esUuid } from "./identificadores";
import { MAXIMO_DE_RENGLONES_DE_UNA_COMPRA } from "./registrar-compra";

/**
 * La orden de compra al proveedor (N4, E9 §3.8; D127): BORRADOR → PEDIDA → CERRADA | ANULADA. Las cantidades van en la UNIDAD BASE del producto y los precios por unidad
 * base, como la factura de N3 (decisión de 0066: no hay conversión entre lo pedido y lo recibido). Pura: sin reloj ni azar.
 */
export const ESTADOS_DE_ORDEN = ["BORRADOR", "PEDIDA", "CERRADA", "ANULADA"] as const;
export type EstadoDeOrden = (typeof ESTADOS_DE_ORDEN)[number];

export type LineaDeOrdenPedida = Readonly<{
  productoId: string;
  /** Texto decimal de hasta 4 decimales, mayor que cero, en la unidad base del producto. */
  cantidad: string;
  /** Por unidad base, texto decimal de hasta 6 decimales, o `null` si la orden no lo lleva («sin precio», nunca cero inventado). */
  precio: string | null;
}>;

export type OrdenPedida = Readonly<{
  proveedorId: string;
  sucursalId: string | null;
  /** Fecha civil `YYYY-MM-DD` o `null`. */
  entrega: string | null;
  lineas: readonly LineaDeOrdenPedida[];
}>;

export type ErrorDeOrden = "IDENTIFICADOR_INVALIDO" | "RENGLONES_INVALIDOS" | "FECHA_INVALIDA";

const comoRegistro = (valor: unknown): Record<string, unknown> =>
  // Stryker disable next-line ConditionalExpression: un texto o un número como «registro» no tiene ninguno de los campos y cae en la misma validación de abajo
  typeof valor === "object" && valor !== null && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : {};

/** Lee una línea: producto (id), cantidad positiva y precio opcional; cualquier otra forma es `null`. Los textos salen en forma canónica. */
function leerLinea(valor: unknown): LineaDeOrdenPedida | null {
  const l = comoRegistro(valor);
  const productoId = l["productoId"];
  const cantidad = typeof l["cantidad"] === "string" ? leerCantidadPositiva(l["cantidad"]) : null;
  const precioCrudo = l["precio"] ?? null;
  const precio = typeof precioCrudo === "string" ? leerPrecioPositivo(precioCrudo) : null;
  // `esUuid` compara con una expresión regular: lo que no es un texto no pasa, sin mirar el tipo antes.
  if (!esUuid(productoId as string) || cantidad === null) return null;
  if (precioCrudo !== null && precio === null) return null;
  return {
    productoId: productoId as string,
    cantidad: textoDeCantidad(cantidad),
    precio: precio === null ? null : textoDePrecio(precio),
  };
}

/**
 * Lee lo que la persona pide: proveedor y sucursal (ids), entrega opcional (fecha civil) y una lista de líneas (no vacía, con tope, sin repetir producto: dos líneas del
 * mismo producto serían una sola con otra cantidad). Que el proveedor, la sucursal y los productos existan y sean de la empresa lo comprueba el caso de uso con lo guardado.
 */
export function leerOrden(valor: unknown): Resultado<OrdenPedida, ErrorDeOrden> {
  const o = comoRegistro(valor);
  const proveedorId = o["proveedorId"];
  const sucursalId = o["sucursalId"] ?? null;
  const entrega = o["entrega"] ?? null;
  if (!esUuid(proveedorId as string)) return err("IDENTIFICADOR_INVALIDO");
  if (sucursalId !== null && !esUuid(sucursalId as string)) {
    return err("IDENTIFICADOR_INVALIDO");
  }
  if (entrega !== null && !esFechaCivil(entrega)) return err("FECHA_INVALIDA");
  const crudas = o["lineas"];
  if (
    !Array.isArray(crudas) ||
    crudas.length === 0 ||
    crudas.length > MAXIMO_DE_RENGLONES_DE_UNA_COMPRA
  ) {
    return err("RENGLONES_INVALIDOS");
  }
  const lineas: LineaDeOrdenPedida[] = [];
  const vistos = new Set<string>();
  for (const cruda of crudas as readonly unknown[]) {
    const linea = leerLinea(cruda);
    if (linea === null || vistos.has(linea.productoId)) return err("RENGLONES_INVALIDOS");
    vistos.add(linea.productoId);
    lineas.push(linea);
  }
  return ok({
    proveedorId: proveedorId as string,
    sucursalId: sucursalId as string | null,
    entrega,
    lineas,
  });
}

/** La huella del pedido de crear la orden: todo el contenido; las líneas se ordenan antes de hashear (las mismas líneas en otro orden son el mismo pedido). */
export function huellaDeLaOrden(orden: OrdenPedida): string {
  return huellaDeComando(
    "crear_orden_de_compra",
    [orden.proveedorId, orden.sucursalId, orden.entrega],
    orden.lineas.map((l) => [l.productoId, l.cantidad, l.precio]),
  );
}
