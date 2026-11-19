import { deDiezmilesimos, sumarCantidades, type ProductoDeLaVenta } from "./modelo-de-venta-rapida";

/**
 * La CUENTA local de la venta rápida: las líneas que se eligieron (no lo que cuestan: eso lo dice el servidor al cotizar), cómo se juntan y el pedido de cotización. Puro: sin React ni servidor.
 * Vive aparte de `modelo-de-venta-rapida.ts` para que ninguno pase el tope de líneas por archivo.
 */

// ─── La cuenta ──────────────────────────────────────────────────────────────────────────────────────────

/** Una línea de la cuenta local: lo que se eligió, no lo que cuesta (eso lo dice el servidor). */
export type LineaDeLaVenta = Readonly<{
  /** Misma configuración (producto, medida y opciones) = misma clave = una sola línea. */
  clave: string;
  productoId: string;
  varianteId: string | null;
  opcionIds: readonly string[];
  /** En diezmilésimos. */
  cantidad: number;
  /** Sube cada vez que otra carga se suma a esta línea desde afuera del campo de la cuenta: la pantalla lo usa para que el campo vuelva a mostrar la cantidad nueva (no cambia al escribir). */
  revision: number;
}>;

/** La clave de una configuración: el producto, la medida y las opciones sin importar el orden en que se tocaron. */
export function claveDeLinea(
  productoId: string,
  varianteId: string | null,
  opcionIds: readonly string[],
): string {
  return JSON.stringify([productoId, varianteId, [...opcionIds].sort()]);
}

/** Agrega a la cuenta: una configuración que ya está suma su cantidad (decimal exacto, tope 9999); una nueva queda al final. No muta la cuenta anterior. */
export function agregarALaCuenta(
  cuenta: readonly LineaDeLaVenta[],
  nueva: Readonly<{
    productoId: string;
    varianteId: string | null;
    opcionIds: readonly string[];
    cantidad: number;
  }>,
): readonly LineaDeLaVenta[] {
  const clave = claveDeLinea(nueva.productoId, nueva.varianteId, nueva.opcionIds);
  if (cuenta.some((l) => l.clave === clave)) {
    return cuenta.map((l) =>
      l.clave === clave
        ? { ...l, cantidad: sumarCantidades(l.cantidad, nueva.cantidad), revision: l.revision + 1 }
        : l,
    );
  }
  return [
    ...cuenta,
    {
      clave,
      productoId: nueva.productoId,
      varianteId: nueva.varianteId,
      opcionIds: [...nueva.opcionIds].sort(),
      cantidad: nueva.cantidad,
      revision: 0,
    },
  ];
}

/** Cambia la cantidad de una línea (la que se escribe en la cuenta). */
export const cambiarCantidad = (
  cuenta: readonly LineaDeLaVenta[],
  clave: string,
  cantidad: number,
): readonly LineaDeLaVenta[] => cuenta.map((l) => (l.clave === clave ? { ...l, cantidad } : l));

/** Quita una línea de la cuenta. */
export const quitarDeLaCuenta = (
  cuenta: readonly LineaDeLaVenta[],
  clave: string,
): readonly LineaDeLaVenta[] => cuenta.filter((l) => l.clave !== clave);

/** Cuánto hay de un producto en la cuenta (todas sus configuraciones), para marcar la tarjeta. */
export const cantidadDelProductoEnLaCuenta = (
  cuenta: readonly LineaDeLaVenta[],
  productoId: string,
): number =>
  cuenta.filter((l) => l.productoId === productoId).reduce((suma, l) => suma + l.cantidad, 0);

/** El pedido de cotización del carrito: solo lo elegido; la sucursal la pone el servidor. Las cantidades viajan como texto decimal. */
export function pedidoDeCotizacion(cuenta: readonly LineaDeLaVenta[]): Readonly<{
  lineas: readonly Readonly<{
    productoId: string;
    varianteId?: string;
    opcionIds: readonly string[];
    cantidad: string;
  }>[];
}> {
  return {
    lineas: cuenta.map((l) => ({
      productoId: l.productoId,
      ...(l.varianteId === null ? {} : { varianteId: l.varianteId }),
      opcionIds: l.opcionIds,
      cantidad: deDiezmilesimos(l.cantidad),
    })),
  };
}

/** El detalle de una línea: la medida y las opciones elegidas, por su nombre, en el orden del producto. Un id que el producto ya no ofrece no se muestra (nunca se inventa un nombre). */
export function detalleDeLaLinea(
  producto: ProductoDeLaVenta,
  linea: LineaDeLaVenta,
): readonly string[] {
  const medida = producto.variante?.opciones.find((o) => o.id === linea.varianteId)?.nombre;
  const opciones = producto.grupos.flatMap((g) =>
    g.opciones.filter((o) => linea.opcionIds.includes(o.id)).map((o) => o.nombre),
  );
  return medida === undefined ? opciones : [medida, ...opciones];
}

/** La cotización del servidor tal como la usa la pantalla: el total y, por línea (en el mismo orden que la cuenta), el precio unitario y el importe. Dinero como texto decimal con su moneda. */
export type CotizacionDeLaVenta = Readonly<{
  total: Readonly<{ moneda: string; monto: string }>;
  lineas: readonly Readonly<{
    precioUnitario: Readonly<{ moneda: string; monto: string }>;
    importe: Readonly<{ moneda: string; monto: string }>;
  }>[];
}>;

// ─── Venta a $ 0 (maqueta `venta-rapida-v4.html:1029`, decisión 155) ────────────────────────────────────

const IMPORTE_EN_CERO = /^0+(\.0+)?$/;

/** ¿Este importe en texto decimal es cero («0», «0.00», «0.000»)? Una sola definición: nunca `number` ni `parseFloat`. */
export const esImporteEnCero = (importe: string): boolean => IMPORTE_EN_CERO.test(importe);

/** Una línea de la cuenta cuyo precio unitario o importe da cero. `lineaId` es la clave de la línea de la cuenta. */
export type LineaACero = Readonly<{ lineaId: string; nombre: string }>;

/** Qué hay que confirmar antes de cobrar. Mira SOLO la cotización del servidor: la pantalla no calcula precios. */
export type ConfirmacionDeCero =
  | Readonly<{ tipo: "NINGUNA" }>
  | Readonly<{ tipo: "TOTAL"; lineasACero: readonly LineaACero[] }>
  | Readonly<{ tipo: "LINEA"; lineasACero: readonly LineaACero[] }>;

/**
 * Total $ 0 → `TOTAL` (se cierra sin cobro); alguna línea a $ 0 dentro de un total mayor → `LINEA` (se confirma y se pasa al cobro); nada a cero → `NINGUNA`.
 * La cotización trae las líneas en el mismo orden que la cuenta. Una línea es «a cero» si su precio unitario o su importe lo es.
 */
export function confirmacionDeCero(
  cuenta: readonly LineaDeLaVenta[],
  nombreDe: (linea: LineaDeLaVenta) => string,
  cotizacion: CotizacionDeLaVenta,
): ConfirmacionDeCero {
  const lineasACero = cuenta.flatMap((linea, indice) => {
    const cotizada = cotizacion.lineas[indice];
    return cotizada !== undefined &&
      (esImporteEnCero(cotizada.precioUnitario.monto) || esImporteEnCero(cotizada.importe.monto))
      ? [{ lineaId: linea.clave, nombre: nombreDe(linea) }]
      : [];
  });
  if (esImporteEnCero(cotizacion.total.monto)) return { tipo: "TOTAL", lineasACero };
  return lineasACero.length === 0 ? { tipo: "NINGUNA" } : { tipo: "LINEA", lineasACero };
}

/** La confirmación que el servidor exige para vender a $ 0 (la lista cerrada vive en el dominio de ventas, `CONFIRMACIONES_DE_VENTA`; el servidor rechaza cualquier otra). */
export const CONFIRMACION_VENTA_A_CERO = "VENTA_A_CERO";

/** Las líneas del pedido de venta (ids por clave de línea). `null` si a alguna le falta su id: nunca un pedido a medias. */
export function lineasDelPedido(
  idsDeLineas: ReadonlyMap<string, string>,
  cuenta: readonly LineaDeLaVenta[],
): readonly Readonly<Record<string, unknown>>[] | null {
  const lineas = cuenta.map((l) => {
    const lineaId = idsDeLineas.get(l.clave);
    return lineaId === undefined
      ? null
      : {
          lineaId,
          productoId: l.productoId,
          ...(l.varianteId === null ? {} : { varianteId: l.varianteId }),
          opcionIds: l.opcionIds,
          cantidad: deDiezmilesimos(l.cantidad),
        };
  });
  return lineas.length === 0 || lineas.includes(null)
    ? null
    : (lineas as readonly Readonly<Record<string, unknown>>[]);
}

/** El pedido de la venta a $ 0: el mismo de cobrar, con `cobros` vacío y la confirmación. `null` si no hay nada que mandar. */
export function pedidoDeVentaACero(entrada: {
  ids: Readonly<{ cuentaId: string; ejemplarId: string; lineas: ReadonlyMap<string, string> }>;
  cajaId: string;
  cuenta: readonly LineaDeLaVenta[];
  total: Readonly<{ moneda: string; monto: string }>;
}): Readonly<Record<string, unknown>> | null {
  const lineas = lineasDelPedido(entrada.ids.lineas, entrada.cuenta);
  if (lineas === null) return null;
  return {
    cuentaId: entrada.ids.cuentaId,
    ejemplarId: entrada.ids.ejemplarId,
    lineas,
    totalEsperado: { moneda: entrada.total.moneda, monto: entrada.total.monto },
    cajaId: entrada.cajaId,
    cobros: [],
    confirmaciones: [CONFIRMACION_VENTA_A_CERO],
  };
}
