/**
 * Las direcciones de las pantallas de Stock (maqueta aprobada `stock.html`, 09/11/2026: Existencias, Movimientos, Conteo y Depósitos; «Lotes» es la quinta, aprobada por el dueño el 25/11/2026, fila 449). Un solo lugar: el menú, las pestañas y los
 * formularios las importan de acá. Puro: sin React ni servidor.
 *
 * `entrada` es adonde lleva la fila «Stock» del menú: Existencias, la primera pestaña de la maqueta.
 */
export const RUTAS_DE_STOCK = {
  existencias: "/stock/existencias",
  movimientos: "/stock/movimientos",
  conteo: "/stock/conteo",
  depositos: "/stock/depositos",
  lotes: "/stock/lotes",
  /** La revisión y el resultado de un conteo (FP-STK-11 y FP-STK-12): no es pestaña, se llega desde Conteo. */
  revisarConteo: "/stock/conteo/revisar",
  /** Corregir y Reasignar un lote (FP-STK-16): no son pestañas, se llega desde los lotes de un artículo. */
  corregirLote: "/stock/lotes/corregir",
  reasignarLote: "/stock/lotes/reasignar",
  /** No es pestaña: se llega por el botón «Carga inicial» de Existencias (FP-STK-08). */
  cargaInicial: "/stock/carga-inicial",
  entrada: "/stock/existencias",
} as const;

// Previene una pestaña que lleva a un 404; cada pantalla de Stock suma su clave acá cuando entra. Chequeo: `PestanasDeStock.test.tsx`.
export const PESTANAS_CONSTRUIDAS = [
  "existencias",
  "movimientos",
  "conteo",
  "depositos",
  "lotes",
] as const;

/** Una pestaña de Stock: adónde lleva, su texto ya resuelto y si es la pantalla actual. */
export type PestanaDeStock = Readonly<{ href: string; texto: string; actual: boolean }>;
