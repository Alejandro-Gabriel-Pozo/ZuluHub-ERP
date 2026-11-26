import { DECIMALES_DE_CANTIDAD, ENTEROS_DE_CANTIDAD } from "../../primitivas/cantidad/cantidad";
import { DECIMALES_DE_MERMA, ENTEROS_DE_MERMA } from "../../primitivas/cantidad/merma";
import {
  DECIMALES_DEL_PORCENTAJE_DE_LA_PARTE,
  ENTEROS_DEL_PORCENTAJE_DE_LA_PARTE,
} from "../../primitivas/cuentas/reparto-por-porcentaje";
import {
  DECIMALES_DE_PRECIO_UNITARIO,
  ENTEROS_DE_PRECIO_UNITARIO,
} from "../../primitivas/dinero/precio-unitario";
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

/** El costo por unidad de una entrada de stock: un precio unitario (hasta 6 decimales, `numeric(18,6)`), sin ceros de relleno. */
export const REGLA_DE_COSTO_UNITARIO: ReglaDeNumero = {
  decimales: DECIMALES_DE_PRECIO_UNITARIO,
  enterosMaximos: ENTEROS_DE_PRECIO_UNITARIO,
};

/** El porcentaje de una parte al dividir la cuenta por porcentaje (SAL-E3): hasta 100 con 2 decimales (decisión del dueño, 14/11/2026), sin ceros de relleno. */
export const REGLA_DE_PORCENTAJE_DE_LA_PARTE: ReglaDeNumero = {
  decimales: DECIMALES_DEL_PORCENTAJE_DE_LA_PARTE,
  enterosMaximos: ENTEROS_DEL_PORCENTAJE_DE_LA_PARTE,
};
