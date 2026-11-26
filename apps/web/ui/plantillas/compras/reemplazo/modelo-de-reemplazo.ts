import {
  facturaParaElServidor,
  sinCerosDeRelleno,
  type FacturaEscrita,
} from "../nueva/modelo-de-factura";
import type { RenglonCotizado, RenglonEscrito } from "../nueva/modelo-de-nueva-compra";
import { rutaDeConciliar, rutaDeLaCompra, rutaDeLasNotas } from "../rutas-de-compras";

/**
 * El modelo de «Reemplazar el comprobante» (NOTAS-2c-2; pantalla 11 de la maqueta de Diseño 2). Puro: sin React ni servidor, y sin ninguna cuenta (las hace el servidor). Decide qué pasos previos se ofrecen (cada uno solo
 * con el permiso de ese paso), el motivo que se precarga, cuándo se avisa que el costo del stock no cambia y qué pedido sale. Mostrar no es autorizar: el servidor revalida los frenos, el permiso, el alcance y la versión
 * dentro de la transacción.
 */

export type FrenoParaLaPantalla = Readonly<{
  freno: "PAGO_VIGENTE" | "CONCILIACIONES_VIVAS" | "NOTAS_VIGENTES";
  pagoId?: string;
}>;

/** Lo que la persona puede hacer en cada paso previo: solo ayuda para ofrecer o esconder enlaces (cada acción vuelve a pasar por el guard). Sin permisos leídos, todo cerrado. */
export type AccionesDelReemplazo = Readonly<{
  anularPago: boolean;
  anularConciliacion: boolean;
  verNotas: boolean;
}>;

export const SIN_ACCIONES_DEL_REEMPLAZO: AccionesDelReemplazo = {
  anularPago: false,
  anularConciliacion: false,
  verNotas: false,
};

/** De dónde sale el paso: la factura vigente (siempre) y, si es una compra (N1/N2), la compra (el pago se anula desde su ficha). */
export type OrigenDelReemplazo = Readonly<{ facturaId: string; recepcionId: string | null }>;

export type PasoPrevio = Readonly<{
  freno: FrenoParaLaPantalla["freno"];
  /** A dónde se va a resolver el paso; `null` si no hay permiso o no hay pantalla donde hacerlo (el paso se muestra sin enlace). */
  ruta: string | null;
}>;

/** Los pasos previos en el orden en que los dio el servidor, cada uno con su enlace solo si hay permiso de ese paso. El pago de una factura que llega sola no tiene pantalla propia: va sin enlace. */
export function pasosPrevios(
  frenos: readonly FrenoParaLaPantalla[],
  origen: OrigenDelReemplazo,
  acciones: AccionesDelReemplazo,
): readonly PasoPrevio[] {
  return frenos.map((f) => ({
    freno: f.freno,
    ruta:
      f.freno === "PAGO_VIGENTE"
        ? acciones.anularPago && origen.recepcionId !== null
          ? rutaDeLaCompra(origen.recepcionId)
          : null
        : f.freno === "CONCILIACIONES_VIVAS"
          ? acciones.anularConciliacion
            ? rutaDeConciliar(origen.facturaId)
            : null
          : acciones.verNotas
            ? rutaDeLasNotas(origen.facturaId)
            : null,
  }));
}

/** El número como lo escribe la persona en el papel: `0005-00001234` (punto de venta de 4 y número de 8, con ceros); incompleto, vacío. */
export function numeroParaElMotivo(puntoDeVenta: string, numero: string): string {
  const pv = puntoDeVenta.trim();
  const n = numero.trim();
  if (pv === "" || n === "") return "";
  return `${pv.padStart(4, "0")}-${n.padStart(8, "0")}`;
}

/** El marcador del número en la plantilla del motivo («Reemplazada por la factura {numero}»), el mismo que declara el catálogo. */
export const MARCADOR_DEL_NUMERO = "{numero}";

/** El motivo que se envía: lo que escribió la persona (aunque sea vacío: entonces no se envía) o, si no tocó el campo, la plantilla con el número de la factura nueva; `""` mientras falta el número. */
export function motivoDelReemplazo(
  escrito: string | null,
  numero: string,
  plantilla: string,
): string {
  if (escrito !== null) return escrito;
  return numero === "" ? "" : plantilla.replace(MARCADOR_DEL_NUMERO, numero);
}

/**
 * Si el importe de la factura nueva difiere del de la original (para avisar que el costo del stock no cambia). Compara TEXTO decimal canónico sin ceros de relleno, sin ninguna cuenta ni número; mientras la persona no
 * escribió el importe no hay nada que comparar (`false`).
 */
export function importeDifiere(original: string, nuevo: string): boolean {
  if (nuevo.trim() === "") return false;
  return sinCerosDeRelleno(original.trim()) !== sinCerosDeRelleno(nuevo.trim());
}

export type PedidoDeReemplazo = Readonly<{
  motivo: string;
  factura: unknown;
}>;

/**
 * El pedido de «Reemplazar»: la factura nueva (la misma de «Nueva compra» y «Cargar factura») y el motivo; `null` mientras falta algo, incluido el motivo en blanco (el botón queda apagado). Con `productoPorRenglon`
 * (N3/N4) cada línea dice su producto; sin él (N2) cada línea dice el renglón de la compra al que corresponde. Nada de dinero se calcula acá.
 */
export function armarElPedidoDeReemplazo(
  factura: FacturaEscrita,
  renglones: readonly RenglonEscrito[],
  motivo: string,
  conProducto: boolean,
): PedidoDeReemplazo | null {
  if (motivo.trim() === "") return null;
  const completa = facturaParaElServidor(
    factura,
    renglones,
    new Map<string, RenglonCotizado>(),
    false,
  );
  if (completa === null) return null;
  if (!conProducto) return { motivo, factura: completa };
  return {
    motivo,
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

/** Las líneas de la compra que se cambia, tal como las dijo el servidor (la ficha de la compra): lo que hace falta para precargar la factura nueva renglón por renglón. */
export type LineaDeLaCompra = Readonly<{
  numero: number;
  producto: string | null;
  /** Lo que entró al stock, en la unidad base: texto decimal canónico. */
  cantidadEnStock: string;
  unidadDeStockId: string | null;
}>;

/**
 * Los renglones de la compra como los espera el bloque de la factura (el mismo de «Nueva compra»): la cantidad precargada es lo que entró al stock, en la unidad base, y el precio queda vacío (lo escribe la persona de la factura
 * nueva: la conversión del precio de compra es del servidor, no de la pantalla). Cada línea de la factura corresponde, en orden, a un renglón de la compra.
 */
export function renglonesDeLaCompra(lineas: readonly LineaDeLaCompra[]): readonly RenglonEscrito[] {
  return lineas.map((l) => ({
    id: l.numero,
    productoId: "",
    nombre: l.producto ?? "",
    unidadBase: l.unidadDeStockId ?? "",
    unidadDeCompra: l.unidadDeStockId ?? "",
    cantidad: sinCerosDeRelleno(l.cantidadEnStock),
    unidadDePrecio: l.unidadDeStockId ?? "",
    precio: "",
  }));
}
