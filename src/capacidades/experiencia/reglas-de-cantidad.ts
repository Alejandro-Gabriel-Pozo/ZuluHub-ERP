import { DECIMALES_DE_CANTIDAD, ENTEROS_DE_CANTIDAD } from "../../primitivas/cantidad/cantidad";
import { DECIMALES_DE_MERMA, ENTEROS_DE_MERMA } from "../../primitivas/cantidad/merma";
import type { ReglaDeNumero } from "./numero-argentino";

/**
 * Las reglas del campo numérico (`CampoNumero`) para lo que se carga en una receta (B6, `recetas-pantalla.md` §4): el rinde y el bruto de cada ingrediente son una cantidad
 * (hasta 4 decimales, `numeric(18,4)`) y la merma son los puntos de 0 a menos de 100 (dos enteros, 4 decimales). Salen de las primitivas, no se escriben acá: una regla, un lugar.
 * Sin ceros de relleno: `5` se queda `5`, no `5.0000`. Previene: un campo que deje escribir lo que la primitiva o la base rechazan (la merma de 100 o más, el quinto decimal).
 * Chequeo: `reglas-de-cantidad.test.ts` (lo que el campo deja escribir y pegar coincide con lo que la primitiva acepta).
 */
export const REGLA_DE_CANTIDAD: ReglaDeNumero = {
  decimales: DECIMALES_DE_CANTIDAD,
  enterosMaximos: ENTEROS_DE_CANTIDAD,
};

export const REGLA_DE_MERMA: ReglaDeNumero = {
  decimales: DECIMALES_DE_MERMA,
  enterosMaximos: ENTEROS_DE_MERMA,
};
