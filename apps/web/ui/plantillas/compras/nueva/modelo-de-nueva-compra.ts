import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../../src/capacidades/vocabulario/vocabulario";
import { CLAVE_DE_TEXTO_DE_UNIDAD } from "../../../../../../src/capacidades/vocabulario/unidades-de-medida";
import { UNIDADES, type CodigoDeUnidad } from "../../../../../../src/primitivas/unidades/unidades";
import { formatearCantidad, formatearImporte } from "../../../patrones/formato-fiscal";

/**
 * El modelo de «Nueva compra» (Compras PR 6b): lo que se escribe, el pedido que sale y cómo se muestra lo que devuelve el servidor. Puro: sin React ni servidor. NO calcula ninguna cantidad ni importe
 * (la cuenta es del servidor: `cotizarCompra` antes de guardar y `registrarCompra` al guardar, la misma función del dominio); solo arma el pedido y muestra lo que vuelve. «Cómo se compra» ofrece las
 * presentaciones activas del producto («caja de 12») y las unidades de su misma dimensión (T0b, dueño 25/11/2026); sin presentaciones se compra en la unidad base como siempre.
 */

/** Una presentación que se puede elegir, tal como la dijo el servidor (`productosParaComprar`): la cantidad es texto decimal en la unidad base. */
export type PresentacionParaElegir = Readonly<{
  id: string;
  nombre: string;
  cantidad: string;
  dePesoVariable: boolean;
}>;

/** El valor de «Precio por» cuando se cobra por la presentación elegida; no es ninguna unidad (ninguna tiene este código). */
export const PRECIO_POR_LA_PRESENTACION = "PRESENTACION";
/** Marca de una presentación en el selector «Cómo se compra», para no confundirla con el código de una unidad. */
const PREFIJO_DE_PRESENTACION = "presentacion:";

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
  /** Las presentaciones activas del producto que se ofrecen; ausente o vacío = se compra por unidad (como hoy). */
  presentaciones?: readonly PresentacionParaElegir[];
  /** La presentación elegida, o ausente/`""` si se compra por unidad. */
  presentacionId?: string;
  /** Peso real recibido, en la unidad base: solo con una presentación de peso variable. Texto decimal o ausente/`""`. */
  pesoReal?: string;
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

/** `conPresentaciones` en falso (por defecto verdadero) es para «Recibir» (recepción separada), que todavía recibe por unidad: no se ofrecen presentaciones que ese pedido no manda. */
export function renglonNuevo(
  id: number,
  producto: Readonly<{
    productoId: string;
    nombre: string;
    unidadBase: string;
    presentaciones?: readonly PresentacionParaElegir[];
  }>,
  conPresentaciones = true,
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
    presentaciones: conPresentaciones ? (producto.presentaciones ?? []) : [],
    presentacionId: "",
    pesoReal: "",
  };
}

/** La presentación que tiene elegida un renglón; `null` si se compra por unidad (o si el id no es de las ofrecidas: nunca se supone una). */
export function presentacionElegida(r: RenglonEscrito): PresentacionParaElegir | null {
  const id = r.presentacionId ?? "";
  if (id === "") return null;
  return (r.presentaciones ?? []).find((p) => p.id === id) ?? null;
}

/** Lo que muestra el selector «Cómo se compra»: el valor elegido (la presentación o la unidad). */
export function valorDeComoSeCompra(r: RenglonEscrito): string {
  const elegida = presentacionElegida(r);
  return elegida === null ? r.unidadDeCompra : `${PREFIJO_DE_PRESENTACION}${elegida.id}`;
}

/** «Caja ×12 (12 unidades)»: la presentación con su cantidad en la unidad base, para el selector. Todo viene de los datos: no se escribe ningún texto. */
function etiquetaDePresentacion(
  p: PresentacionParaElegir,
  unidadBase: string,
  d: DiccionarioResuelto,
): string {
  const unidad = nombreDeUnidad(unidadBase, d);
  return `${p.nombre} (${formatearCantidad(p.cantidad)}${unidad === "" ? "" : ` ${unidad}`})`;
}

/**
 * Las opciones de «Cómo se compra»: primero las presentaciones del producto, después las unidades de su misma dimensión (las de otra dimensión aparecen apagadas, como hasta ahora). Un producto sin
 * presentaciones ofrece exactamente lo de siempre.
 */
export function opcionesDeComoSeCompra(
  r: RenglonEscrito,
  d: DiccionarioResuelto = {},
): readonly OpcionDeUnidad[] {
  const deLasPresentaciones = (r.presentaciones ?? []).map((p) => ({
    valor: `${PREFIJO_DE_PRESENTACION}${p.id}`,
    etiqueta: etiquetaDePresentacion(p, r.unidadBase, d),
    apagada: false,
  }));
  return [...deLasPresentaciones, ...opcionesDeUnidad(r.unidadBase, d)];
}

/**
 * Las opciones de «Precio por»: las unidades de siempre y, con una presentación elegida, esa presentación («$ 12.000 la caja»). El rótulo de la opción es el nombre de la presentación: ningún texto nuevo.
 */
export function opcionesDePrecioPor(
  r: RenglonEscrito,
  d: DiccionarioResuelto = {},
): readonly OpcionDeUnidad[] {
  const elegida = presentacionElegida(r);
  const unidades = opcionesDeUnidad(r.unidadBase, d);
  return elegida === null
    ? unidades
    : [
        { valor: PRECIO_POR_LA_PRESENTACION, etiqueta: elegida.nombre, apagada: false },
        ...unidades,
      ];
}

/**
 * Lo que cambia en el renglón al elegir otra forma de comprar. Una presentación se cuenta en la unidad base (su cantidad ya está en ella), y el peso real de la anterior no vale para la nueva. Al pasar
 * a una unidad, un «Precio por» que era la presentación vuelve a la unidad base (la presentación ya no existe en el renglón).
 */
export function cambiosAlElegirComoSeCompra(
  r: RenglonEscrito,
  valor: string,
): Partial<Omit<RenglonEscrito, "id" | "productoId">> {
  if (valor.startsWith(PREFIJO_DE_PRESENTACION)) {
    const id = valor.slice(PREFIJO_DE_PRESENTACION.length);
    if (!(r.presentaciones ?? []).some((p) => p.id === id)) return {};
    return { presentacionId: id, unidadDeCompra: r.unidadBase, pesoReal: "" };
  }
  return {
    presentacionId: "",
    pesoReal: "",
    unidadDeCompra: valor,
    ...(r.unidadDePrecio === PRECIO_POR_LA_PRESENTACION ? { unidadDePrecio: r.unidadBase } : {}),
  };
}

/** El renglón tiene todo lo que la cotización necesita: cantidad y, si la presentación es de peso variable, el peso real (sin él el servidor rechazaría la cotización de TODOS los renglones). */
export function renglonCompleto(r: RenglonEscrito): boolean {
  if (r.cantidad === "") return false;
  return presentacionElegida(r)?.dePesoVariable !== true || (r.pesoReal ?? "") !== "";
}

export const idSiguiente = (renglones: readonly RenglonEscrito[]): number =>
  renglones.reduce((mayor, r) => Math.max(mayor, r.id), 0) + 1;

export const conRenglon = (
  renglones: readonly RenglonEscrito[],
  id: number,
  cambios: Partial<Omit<RenglonEscrito, "id" | "productoId">>,
): readonly RenglonEscrito[] => renglones.map((r) => (r.id === id ? { ...r, ...cambios } : r));

/**
 * El renglón como lo pide el servidor (cotizar y registrar): todo texto; sin precio, sin unidad de precio. Con presentación va su id y, si es de peso variable, el peso real (nunca el de una presentación
 * de peso fijo: el servidor lo rechaza); «Precio por» la presentación no lleva unidad de precio.
 */
function renglonParaElServidor(r: RenglonEscrito) {
  const conPrecio = r.precio !== "";
  const presentacion = presentacionElegida(r);
  const porLaPresentacion =
    presentacion !== null && r.unidadDePrecio === PRECIO_POR_LA_PRESENTACION;
  const conPeso = presentacion?.dePesoVariable === true && (r.pesoReal ?? "") !== "";
  return {
    productoId: r.productoId,
    presentacionId: presentacion === null ? null : presentacion.id,
    unidadDeCompraId: r.unidadDeCompra,
    cantidad: r.cantidad,
    pesoReal: conPeso ? (r.pesoReal ?? null) : null,
    precioPor: porLaPresentacion ? ("PRESENTACION" as const) : ("UNIDAD" as const),
    unidadDePrecioId: conPrecio && !porLaPresentacion ? r.unidadDePrecio : null,
    precio: conPrecio ? r.precio : null,
  };
}

/** Los renglones completos (cantidad y, con peso variable, el peso real): solo esos se cotizan (uno incompleto no tiene qué mostrar y haría rechazar a los demás). */
export const renglonesParaCotizar = (renglones: readonly RenglonEscrito[]) =>
  renglones.filter(renglonCompleto).map(renglonParaElServidor);

export type RemitoEscrito = Readonly<{ puntoDeVenta: string; numero: string; fecha: string }>;
export const REMITO_VACIO: RemitoEscrito = { puntoDeVenta: "", numero: "", fecha: "" };

export type PedidoDeCompra = Readonly<{
  proveedorId: string;
  depositoId: string | null;
  remito: RemitoEscrito;
  renglones: ReturnType<typeof renglonParaElServidor>[];
  /** La factura, solo en «Con factura». */
  factura?: unknown;
}>;

/** El pedido que sale al guardar. Un renglón sin cantidad NO se descarta en silencio: sale igual y el servidor lo rechaza (nunca se guarda una compra distinta de la que se ve). */
export function armarElPedido(
  proveedorId: string,
  depositoId: string | null,
  remito: RemitoEscrito,
  renglones: readonly RenglonEscrito[],
  factura?: unknown,
): PedidoDeCompra {
  return {
    proveedorId,
    depositoId,
    remito,
    renglones: renglones.map(renglonParaElServidor),
    ...(factura === undefined ? {} : { factura }),
  };
}

/** El renglón de una recepción separada: el producto, la unidad de compra y la cantidad, y NADA más (no se pide precio: el costo se toma de la factura al conciliar). */
function renglonDeRecepcionParaElServidor(r: RenglonEscrito) {
  return { productoId: r.productoId, unidadDeCompraId: r.unidadDeCompra, cantidad: r.cantidad };
}

export type PedidoDeRecepcion = Readonly<{
  proveedorId: string;
  remito: RemitoEscrito;
  renglones: ReturnType<typeof renglonDeRecepcionParaElServidor>[];
}>;

/** El pedido de «Recibir»: sin depósito (se elige al confirmar), sin factura y sin precio. Un renglón sin cantidad NO se descarta en silencio: sale igual y el servidor lo rechaza. */
export function armarElPedidoDeRecepcion(
  proveedorId: string,
  remito: RemitoEscrito,
  renglones: readonly RenglonEscrito[],
): PedidoDeRecepcion {
  return { proveedorId, remito, renglones: renglones.map(renglonDeRecepcionParaElServidor) };
}

export type RenglonCotizado = Readonly<{
  productoId: string;
  cantidadEnStock: string;
  importe: string | null;
  costoPorUnidadDeStock: string | null;
}>;

/** Lo que devuelve `cotizarCompra` (la misma forma que `CompraCotizadaParaLaPantalla` de la composición: la UI no importa la composición). */
export type CompraCotizada = Readonly<{
  renglones: readonly RenglonCotizado[];
  /** La suma que calcula el servidor (la pantalla no suma dinero); `null` si algún renglón no tiene precio. */
  total: string | null;
}>;

/** Un producto que se puede comprar, tal como lo entrega `productosParaComprar` (la misma forma que `ProductosParaComprarEnLaPantalla`). */
type ProductoParaElegir = Readonly<{
  productoId: string;
  nombre: string;
  unidadBase: string;
  presentaciones?: readonly PresentacionParaElegir[];
}>;
export type ProductosParaElegir = Readonly<{ productos: readonly ProductoParaElegir[] }>;

/** Un proveedor de la lista de «Nueva compra»: el id, el nombre y si ya tiene su CUIT (sin él, la primera factura lo pide). */
export type ProveedorParaElegir = Readonly<{ id: string; nombre: string; tieneCuit: boolean }>;

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

/**
 * El total del pie: el que calculó el servidor, o «Sin precio» si algún renglón no tiene precio (la misma regla y el mismo texto que la lista y la ficha: nunca un total parcial ni cero). Solo se
 * muestra cuando TODOS los renglones están completos (con uno sin cantidad la cotización no los trae a todos y el total estaría incompleto) y ya hay cotización de lo que se ve.
 */
export function totalDelPie(
  renglones: readonly RenglonEscrito[],
  cotizada: CompraCotizada | null,
  sinPrecio: string,
): string | null {
  if (cotizada === null || renglones.length === 0 || !renglones.every(renglonCompleto)) {
    return null;
  }
  return cotizada.total === null ? sinPrecio : formatearImporte(cotizada.total);
}

/** Los productos que quedan para elegir: los que ya están en la compra no se ofrecen otra vez (una línea por producto). */
export const sinLosYaAgregados = <T extends Readonly<{ productoId: string }>>(
  productos: readonly T[],
  renglones: readonly RenglonEscrito[],
): readonly T[] => productos.filter((p) => !renglones.some((r) => r.productoId === p.productoId));
