import type { ClaveAccion } from "../modulos/catalogo";

/**
 * Cómo declara un caso de uso (o una consulta) qué acción del catálogo exige (cruce X1 de ADR-003), o
 * por qué no pasa por el guard. Lo comparten los módulos: una acción que no existe en el catálogo, o
 * una declaración vacía, no compila.
 */
export type DeclaracionDeCaso = Readonly<{ accion: ClaveAccion }> | Readonly<{ sinGuard: string }>;

/**
 * Cómo se repite un caso de uso sin duplicar (ADR-015 §4). Cada valor es una forma distinta de reconocer la repetición:
 *
 *  - `CLAVE_DE_IDEMPOTENCIA`: el llamador manda un identificador del pedido (clave, `id` de la pantalla, solicitud) y la
 *    repetición se reconoce por él: el mismo identificador con lo mismo devuelve lo mismo; con otra cosa, un error con nombre.
 *  - `YA_ESTABA`: regla natural; sin identificador del pedido, la repetición se reconoce porque el estado pedido ya es el actual
 *    (ya inactiva, ya revocada, ya había una pendiente): éxito sin escribir ni auditar de nuevo.
 *  - `SIN_CAMBIOS`: el pedido fija valores (editar, o el conjunto final) y ya son esos: se devuelve lo vigente, sin escribir.
 *  - `RECHAZA_LA_REPETICION`: la repetición no repite el efecto ni da «ya estaba»: se rechaza con un error con nombre y no
 *    escribe. Solo `resincronizarSerie` (la serie ya `LIBRE` da `SERIE_NO_BLOQUEADA`, spec H7 facturación §B.4.6).
 *
 * Una operación sin efecto que repetir (una lectura) no es un caso de uso: no declara nada de esto. Ningún caso de uso actual
 * necesita un «no aplica»; si aparece uno, se suma el valor con su motivo escrito en ese momento (no antes: sin uso no se mantiene).
 */
export const REGLAS_DE_REPETICION = [
  "CLAVE_DE_IDEMPOTENCIA",
  "YA_ESTABA",
  "SIN_CAMBIOS",
  "RECHAZA_LA_REPETICION",
] as const;

/** Dónde está la prueba de «repetir la misma acción»: el archivo (desde la raíz del repositorio) y el título exacto de su `it`. */
export type PruebaDeRepeticion = Readonly<{ archivo: string; it: string }>;

/**
 * La declaración de repetición de un caso de uso: la regla y la prueba que la fija.
 * Previene: un caso de uso que sale sin que nadie haya decidido ni probado qué pasa al repetirlo (doble clic, reintento de red:
 * filas o auditorías duplicadas), o cuya prueba se borró, se renombró o se salteó con `it.skip` sin que nada lo note. Caso real:
 * el inventario del 2026-11-03 halló tres casos sin prueba de repetición (`emitirNotaDeDebito`, `validarComprobante`,
 * `resincronizarSerie`) y la regla vivía solo en comentarios.
 * Chequeo: sin el campo no compila (`DeclaracionDeCasoDeUso`); que la prueba exista lo mira `composicion.test.ts`
 * («cada caso de uso declara cómo se repite»), con una violación inyectada por cada forma de faltar.
 */
export type RepeticionDeCaso = Readonly<{
  regla: (typeof REGLAS_DE_REPETICION)[number];
  prueba: PruebaDeRepeticion;
}>;

/** La declaración de un caso de uso: el guard (`DeclaracionDeCaso`) y cómo se repite. Las consultas siguen con `DeclaracionDeCaso`. */
export type DeclaracionDeCasoDeUso = DeclaracionDeCaso & Readonly<{ repeticion: RepeticionDeCaso }>;
