import {
  DECIMALES_DE_LA_CANTIDAD,
  ENTEROS_MAXIMOS_DE_LA_CANTIDAD,
} from "../../primitivas/cantidad/cantidad";
import type { ReglaDeNumero } from "./numero-argentino";

/**
 * La regla de la cantidad para el campo numérico: los decimales y los enteros que admite la primitiva de cantidad (`numeric(18,4)`); sin ceros de relleno (`1,5` se queda en `1.5`).
 * Una regla, un lugar: los límites salen de la primitiva, no se repiten acá. Chequeo: `cantidad-tipeada.test.ts`.
 */
export const REGLA_DE_CANTIDAD: ReglaDeNumero = {
  decimales: DECIMALES_DE_LA_CANTIDAD,
  enterosMaximos: ENTEROS_MAXIMOS_DE_LA_CANTIDAD,
};
