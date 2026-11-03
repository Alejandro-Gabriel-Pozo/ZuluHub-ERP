import type { ClaveAccion } from "../modulos/catalogo";

/**
 * Cómo declara un caso de uso (o una consulta) qué acción del catálogo exige (cruce X1 de ADR-003), o
 * por qué no pasa por el guard. Lo comparten los módulos: una acción que no existe en el catálogo, o
 * una declaración vacía, no compila.
 */
export type DeclaracionDeCaso = Readonly<{ accion: ClaveAccion }> | Readonly<{ sinGuard: string }>;

/**
 * Cómo se repite un caso de uso sin duplicar. Fuentes: ADR-015 §4 («cada operación declara por escrito cómo se repite sin
 * duplicar (regla natural, restricción única o `SIN_CAMBIOS`) y tiene una prueba de "repetir la misma acción"; solo si no tiene
 * regla natural se le suma una clave de idempotencia»), reglas-transversales §8 (justificar cada regla con su chequeo) y la
 * autorización del dueño del 2026-11-03 («Hacer 1 ya»: campo de repetición en las declaraciones, chequeo de cobertura y las
 * pruebas faltantes). Correspondencia con el ADR-015 §4:
 *
 *  - `YA_ESTABA` = regla natural o restricción única: sin identificador del pedido, la repetición se reconoce porque el estado
 *    pedido ya es el actual (ya inactiva, ya revocada, ya había una pendiente): éxito sin escribir ni auditar de nuevo.
 *  - `SIN_CAMBIOS` = `SIN_CAMBIOS`: el pedido fija valores (editar, o el conjunto final) y ya son esos: se devuelve lo vigente.
 *  - `CLAVE_DE_IDEMPOTENCIA` = la clave de idempotencia: el llamador manda un identificador del pedido (clave, `id` de la
 *    pantalla, solicitud) y la repetición se reconoce por él; el mismo identificador con otra cosa da un error con nombre.
 *  - `RECHAZA_LA_REPETICION`: la repetición no repite el efecto ni da «ya estaba»: se rechaza con un error con nombre y no
 *    escribe. Hoy solo `resincronizarSerie` (la serie ya `LIBRE` da `SERIE_NO_BLOQUEADA`, spec H7 facturación §B.4.6).
 *  - `NO_APLICA`: el caso no se protege solo contra la repetición. Exige `motivo` escrito, que dice quién la evita y dónde.
 *
 * Alcance: los casos de uso de empresa (empresas, identidad, fiscal). Los de `src/plataforma/casos-de-uso` quedan fuera: no
 * usan `DeclaracionDeCaso` y se escriben sobre la plantilla `casoDePlataforma` (`caso-de-plataforma.ts`), que ya exige una
 * `claveDeIdempotencia` con su tabla; el ADR-015 §4 habla de las «operaciones de empresa». Las consultas tampoco: no tienen
 * efecto que repetir.
 */
export const REGLAS_DE_REPETICION = [
  "CLAVE_DE_IDEMPOTENCIA",
  "YA_ESTABA",
  "SIN_CAMBIOS",
  "RECHAZA_LA_REPETICION",
  "NO_APLICA",
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
export type RepeticionDeCaso =
  | Readonly<{
      regla: Exclude<(typeof REGLAS_DE_REPETICION)[number], "NO_APLICA">;
      prueba: PruebaDeRepeticion;
    }>
  | Readonly<{ regla: "NO_APLICA"; motivo: string; prueba: PruebaDeRepeticion }>;

/** La declaración de un caso de uso: el guard (`DeclaracionDeCaso`) y cómo se repite. Las consultas siguen con `DeclaracionDeCaso`. */
export type DeclaracionDeCasoDeUso = DeclaracionDeCaso & Readonly<{ repeticion: RepeticionDeCaso }>;
