import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../../src/capacidades/vocabulario/vocabulario";
import { CLAVE_DE_TEXTO_DE_UNIDAD } from "../../../../../../src/capacidades/vocabulario/unidades-de-medida";
import { UNIDADES, type CodigoDeUnidad } from "../../../../../../src/primitivas/unidades/unidades";
import { formatearCantidad, formatearImporte } from "../../../patrones/formato-fiscal";

/**
 * El modelo de «Nueva compra» (Compras PR 6b): lo que se escribe, el pedido que sale y cómo se muestra lo que devuelve el servidor. Puro: sin React ni servidor. NO calcula ninguna cantidad ni importe
 * (la cuenta es del servidor: `cotizarCompra` antes de guardar y `registrarCompra` al guardar, la misma función del dominio); solo arma el pedido y muestra lo que vuelve. La primera versión compra en la
 * UNIDAD BASE del producto (o en otra de su misma dimensión), sin presentaciones: hoy no hay pantalla de Catálogo para crearlas (diferencia con la maqueta, aceptada por el dueño el 23/11/2026).
 */

/** Un renglón tal como se escribe: todo texto, el producto con su unidad base (la que dijo el servidor). */
export type RenglonEscrito = Readonly<{
  /** Identifica el renglón en la pantalla (no viaja). */
  id: number;
  productoId: string;
  nombre: string;
  /** La unidad base del producto (la de stock), tal como la dijo el servidor. */
  unidadBase: string;
  unidadDeCompra: string;
  /** Texto decimal canónico o `""`. */
  cantidad: string;
  unidadDePrecio: string;
  /** Texto decimal canónico o `""` (sin precio). */
  precio: string;
}>;

export type OpcionDeUnidad = Readonly<{ valor: string; etiqueta: string; apagada: boolean }>;

const esUnidad = (valor: string): valor is CodigoDeUnidad => Object.hasOwn(UNIDADES, valor);

/**
 * Las unidades que se ofrecen para un producto: las de su misma dimensión se pueden elegir; las de otra dimensión aparecen deshabilitadas (maqueta `compra.html`, estado «Cómo se compra»: los litros
 * no se ofrecen para el bife). Si el servidor dijera una unidad base desconocida no se ofrece nada: nunca una unidad que el servidor no conoce.
 */
export function opcionesDeUnidad(
  unidadBase: string,
  d: DiccionarioResuelto = {},
): readonly OpcionDeUnidad[] {
  if (!esUnidad(unidadBase)) return [];
  const dimension = UNIDADES[unidadBase].dimension;
  return (Object.keys(UNIDADES) as CodigoDeUnidad[]).map((codigo) => ({
    valor: codigo,
    etiqueta: texto(d, CLAVE_DE_TEXTO_DE_UNIDAD[codigo]),
    apagada: UNIDADES[codigo].dimension !== dimension,
  }));
}

/** El nombre de una unidad para mostrar (su texto aprobado); vacío si no es una unidad conocida. */
export function nombreDeUnidad(codigo: string, d: DiccionarioResuelto = {}): string {
  return esUnidad(codigo) ? texto(d, CLAVE_DE_TEXTO_DE_UNIDAD[codigo]) : "";
}

export function renglonNuevo(
  id: number,
  producto: Readonly<{ productoId: string; nombre: string; unidadBase: string }>,
): RenglonEscrito {
  return {
    id,
    productoId: producto.productoId,
    nombre: producto.nombre,
    unidadBase: producto.unidadBase,
    unidadDeCompra: producto.unidadBase,
    cantidad: "",
    unidadDePrecio: producto.unidadBase,
    precio: "",
  };
}

export const idSiguiente = (renglones: readonly RenglonEscrito[]): number =>
  renglones.reduce((mayor, r) => Math.max(mayor, r.id), 0) + 1;

export const conRenglon = (
  renglones: readonly RenglonEscrito[],
  id: number,
  cambios: Partial<Omit<RenglonEscrito, "id" | "productoId">>,
): readonly RenglonEscrito[] => renglones.map((r) => (r.id === id ? { ...r, ...cambios } : r));

/** El renglón como lo pide el servidor (cotizar y registrar): todo texto; sin precio, sin unidad de precio; siempre «por unidad» (no hay presentaciones todavía). */
function renglonParaElServidor(r: RenglonEscrito) {
  const conPrecio = r.precio !== "";
  return {
    productoId: r.productoId,
    unidadDeCompraId: r.unidadDeCompra,
    cantidad: r.cantidad,
    precioPor: "UNIDAD" as const,
    unidadDePrecioId: conPrecio ? r.unidadDePrecio : null,
    precio: conPrecio ? r.precio : null,
  };
}

/** Los renglones que ya tienen cantidad: solo esos se cotizan (uno sin cantidad no tiene qué mostrar y haría rechazar a los demás). */
export const renglonesParaCotizar = (renglones: readonly RenglonEscrito[]) =>
  renglones.filter((r) => r.cantidad !== "").map(renglonParaElServidor);

export type RemitoEscrito = Readonly<{ puntoDeVenta: string; numero: string; fecha: string }>;
export const REMITO_VACIO: RemitoEscrito = { puntoDeVenta: "", numero: "", fecha: "" };

export type PedidoDeCompra = Readonly<{
  proveedorId: string;
  depositoId: string | null;
  remito: RemitoEscrito;
  renglones: ReturnType<typeof renglonParaElServidor>[];
}>;

/** El pedido que sale al guardar. Un renglón sin cantidad NO se descarta en silencio: sale igual y el servidor lo rechaza (nunca se guarda una compra distinta de la que se ve). */
export function armarElPedido(
  proveedorId: string,
  depositoId: string | null,
  remito: RemitoEscrito,
  renglones: readonly RenglonEscrito[],
): PedidoDeCompra {
  return {
    proveedorId,
    depositoId,
    remito,
    renglones: renglones.map(renglonParaElServidor),
  };
}

export type RenglonCotizado = Readonly<{
  productoId: string;
  cantidadEnStock: string;
  importe: string | null;
  costoPorUnidadDeStock: string | null;
}>;

/** Lo que devuelve `cotizarCompra` (la misma forma que `CompraCotizadaParaLaPantalla` de la composición: la UI no importa la composición). */
export type CompraCotizada = Readonly<{ renglones: readonly RenglonCotizado[] }>;

/** Un producto que se puede comprar, tal como lo entrega `productosParaComprar` (la misma forma que `ProductosParaComprarEnLaPantalla`). */
type ProductoParaElegir = Readonly<{
  productoId: string;
  nombre: string;
  unidadBase: string;
}>;
export type ProductosParaElegir = Readonly<{ productos: readonly ProductoParaElegir[] }>;

/** Un proveedor de la lista de «Nueva compra»: solo el id y el nombre. */
export type ProveedorParaElegir = Readonly<{ id: string; nombre: string }>;

export type TextosDelResumen = Readonly<{
  entraATuStock: string;
  costoPorUnidadDeStock: string;
  sinPrecio: string;
}>;

export type ResumenDeRenglon = Readonly<{
  /** «Entra a tu stock: 12,5 kg». */
  entra: string;
  /** «Costo por unidad de stock: $ 1.800,00» o «… Sin precio». */
  costo: string;
  /** El importe de la línea o «Sin precio»: nunca cero. */
  importe: string;
}>;

/** Lo que vuelve del servidor para un renglón, listo para mostrar. Sin cotización (todavía no hay cantidad o la lectura falló) no se muestra nada. */
export function resumenDeRenglon(
  r: RenglonEscrito,
  cotizado: RenglonCotizado | undefined,
  textos: TextosDelResumen,
  d: DiccionarioResuelto = {},
): ResumenDeRenglon | null {
  if (cotizado === undefined) return null;
  const unidad = nombreDeUnidad(r.unidadBase, d);
  return {
    entra:
      `${textos.entraATuStock}: ${formatearCantidad(cotizado.cantidadEnStock)} ${unidad}`.trimEnd(),
    costo: `${textos.costoPorUnidadDeStock}: ${
      cotizado.costoPorUnidadDeStock === null
        ? textos.sinPrecio
        : formatearImporte(cotizado.costoPorUnidadDeStock)
    }`,
    importe: cotizado.importe === null ? textos.sinPrecio : formatearImporte(cotizado.importe),
  };
}

/** Los productos que quedan para elegir: los que ya están en la compra no se ofrecen otra vez (una línea por producto). */
export const sinLosYaAgregados = <T extends Readonly<{ productoId: string }>>(
  productos: readonly T[],
  renglones: readonly RenglonEscrito[],
): readonly T[] => productos.filter((p) => !renglones.some((r) => r.productoId === p.productoId));
