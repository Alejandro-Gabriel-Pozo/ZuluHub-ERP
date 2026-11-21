/**
 * Las direcciones de las cuatro pantallas de Stock (maqueta aprobada `stock.html`, 09/11/2026: Existencias, Movimientos, Conteo y Depósitos). Un solo lugar: el menú, las pestañas y los
 * formularios las importan de acá. Puro: sin React ni servidor.
 *
 * `entrada` es adonde lleva la fila «Stock» del menú. Hoy es Depósitos porque es la única pantalla construida; cuando entre Existencias (la primera pestaña de la maqueta) pasa a ser esa.
 */
export const RUTAS_DE_STOCK = {
  existencias: "/stock/existencias",
  movimientos: "/stock/movimientos",
  conteo: "/stock/conteo",
  depositos: "/stock/depositos",
  entrada: "/stock/depositos",
} as const;

// Previene una pestaña que lleva a un 404; cada pantalla de Stock suma su clave acá cuando entra. Chequeo: `PestanasDeStock.test.tsx`.
export const PESTANAS_CONSTRUIDAS = ["depositos"] as const;

/** Una pestaña de Stock: adónde lleva, su texto ya resuelto y si es la pantalla actual. */
export type PestanaDeStock = Readonly<{ href: string; texto: string; actual: boolean }>;
