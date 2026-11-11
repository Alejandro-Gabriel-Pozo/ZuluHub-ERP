import type { ClaveAccion } from "../../../capacidades/modulos/catalogo";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import { type AvisoDeExplosion } from "../dominio/explosion";
import type { TxDeStock } from "./contrato";
import type { DetalleDeNegativo } from "./errores";
import { type RenglonPedido } from "./movimientos-comun";

/**
 * Los puertos de venta de stock (E5 §3.3): lo que ventas (y compras) llaman en SU transacción. Ninguno tiene acción propia: la autorización la
 * puso quien llama y se guarda en `movimiento.accion`. Lo que recibe cada uno viene de otro módulo, así que se vuelve a comprobar su forma (lista
 * de permitidos) y nunca se supone. Acá vive la lógica; `puertos.ts` (raíz del módulo) declara los contratos y arma los objetos.
 */

/** Lo que leen la explosión y las lecturas de venta: los repositorios de stock y el lector del catálogo, sobre la misma transacción. */
export type TxDeLecturaDeStock = Pick<
  TxDeStock,
  | "articulosDeStock"
  | "composicionesDeStock"
  | "productosParaStock"
  | "depositos"
  | "movimientosDeStock"
  // E6: lo disponible de un artículo con control de lote (la regla de los lotes y la jornada de la sucursal).
  | "lotesDeStock"
  | "sucursales"
  | "costosDeStock"
>;

/** Un sello para los orígenes que acepta cada puerto: el ejemplar de un ticket (ventas) y la recepción (compras). */
export type OrigenDeVenta = Readonly<{ tipo: "EJEMPLAR_DE_TICKET"; id: string }>;
export type OrigenDeRecepcion = Readonly<{ tipo: "RECEPCION"; id: string }>;

export type OpcionVendida = Readonly<{ versionDeOpcionId: string }>;

/** Una línea del ticket tal como la sella ventas: producto, cantidad exacta en la unidad de venta, variante elegida y opciones, con su versión. */
export type RenglonDeVenta = Readonly<{
  /** La posición de la línea en el ticket (entero desde 1, sin repetir): a ella se refieren las excepciones. */
  posicion: number;
  productoId: string;
  /** Texto decimal exacto (hasta 4 decimales), en `unidadDeVentaId`. */
  cantidad: string;
  unidadDeVentaId: string;
  /** La versión de la opción de la variante de tamaño que se eligió (de ella sale el factor de tamaño). */
  varianteVersionDeOpcionId?: string | undefined;
  opciones: readonly OpcionVendida[];
}>;

export type EntradaDeSalidaPorVenta = Readonly<{
  origen: OrigenDeVenta;
  /** La acción de permiso con que el llamador autorizó la venta (se guarda en el libro). */
  accion: ClaveAccion;
  depositoId: string;
  /** El `ahora` del ticket. */
  hechoEn: Date;
  /** La jornada del TICKET (la fija ventas): stock nunca la deriva de `hechoEn`. */
  fechaDeNegocio: FechaCivil;
  renglones: readonly RenglonDeVenta[];
  /** `["stock.existencia_negativa"]` cuando la persona confirmó que va a quedar en negativo (nivel `AVISAR`). */
  confirmaciones?: readonly string[] | undefined;
}>;

/** Algo que el llamador debería saber y que no impide la venta. */
export type AvisoDeSalidaPorVenta =
  AvisoDeExplosion | (Readonly<{ tipo: "EXISTENCIA_NEGATIVA" }> & DetalleDeNegativo);

export type SalidaDeSalidaPorVenta = Readonly<{
  /** `null` si ninguna línea descuenta (todas sin receta o sin control): no se escribió ningún movimiento. */
  movimientoId: string | null;
  /** `true`: ya había una salida de ese ejemplar (el primer hecho manda): no se escribió ni se auditó nada. */
  yaExistia: boolean;
  /** La venta pasa igual (D140): la línea de un `VENDIBLE` sin receta no descuenta. */
  excepciones: readonly Readonly<{ posicion: number; tipo: "FALTA_RECETA" }>[];
  avisos: readonly AvisoDeSalidaPorVenta[];
}>;

export type EntradaDeReversionPorOrigen = Readonly<{
  origen: OrigenDeVenta;
  accion: ClaveAccion;
  /** Por qué se revierte: obligatorio (queda en el libro). */
  detalle: string;
}>;
export type SalidaDeReversionPorOrigen = Readonly<{
  /** `null` si ese ejemplar nunca tuvo salida. */
  anulacionId: string | null;
  habiaSalida: boolean;
  /** `true`: la salida ya estaba revertida (una sola anulación por movimiento). */
  yaExistia: boolean;
}>;

export type ControlDeUnProducto = Readonly<{ controla: boolean; faltaReceta: boolean }>;
export type ExistenciaDeProducto = Readonly<{
  productoId: string;
  /** Texto decimal exacto en la unidad de stock; negativa si el control lo permitió. */
  existencia: string;
  unidadId: string;
}>;

export type RenglonDeEntradaPorOrigen = RenglonPedido;
export type EntradaDeEntradaPorOrigen = Readonly<{
  /** UUID del pedido (idempotencia secundaria: la identidad es el origen). */
  clave: string;
  origen: OrigenDeRecepcion;
  accion: ClaveAccion;
  depositoId: string;
  motivo: "COMPRA";
  hechoEn?: Date | undefined;
  renglones: readonly RenglonDeEntradaPorOrigen[];
}>;
export type SalidaDeEntradaPorOrigen = Readonly<{ movimientoId: string; yaExistia: boolean }>;
