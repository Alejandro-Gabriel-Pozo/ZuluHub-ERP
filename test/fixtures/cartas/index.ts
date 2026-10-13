import { BARBERIA } from "./barberia";
import { CAFETERIA } from "./cafeteria";
import { HOSTERIA } from "./hosteria";
import { PANADERIA } from "./panaderia";
import type { CartaDeEjemplo } from "./tipos";

export { BARBERIA, CAFETERIA, HOSTERIA, PANADERIA };
export type { CartaDeEjemplo, ProductoDeEjemplo } from "./tipos";

/** Las cuatro cartas de ejemplo (C-0), en el orden del spec. */
export const CARTAS_DE_EJEMPLO: readonly CartaDeEjemplo[] = [
  CAFETERIA,
  PANADERIA,
  HOSTERIA,
  BARBERIA,
];
