import { BARBERIA } from "./barberia";
import { CAFETERIA } from "./cafeteria";
import { HOSTERIA } from "./hosteria";
import { PANADERIA } from "./panaderia";
import type { VidrieraDeEjemplo } from "./tipos";

export { BARBERIA, CAFETERIA, HOSTERIA, PANADERIA };
export type { VidrieraDeEjemplo, ProductoDeEjemplo } from "./tipos";

/** Las cuatro cartas de ejemplo (C-0), en el orden del spec. */
export const VIDRIERAS_DE_EJEMPLO: readonly VidrieraDeEjemplo[] = [
  CAFETERIA,
  PANADERIA,
  HOSTERIA,
  BARBERIA,
];
