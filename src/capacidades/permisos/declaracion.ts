import type { ClaveAccion } from "../modulos/catalogo";

/**
 * Cómo declara un caso de uso (o una consulta) qué acción del catálogo exige (cruce X1 de ADR-003), o
 * por qué no pasa por el guard. Lo comparten los módulos: una acción que no existe en el catálogo, o
 * una declaración vacía, no compila.
 */
export type DeclaracionDeCaso = Readonly<{ accion: ClaveAccion }> | Readonly<{ sinGuard: string }>;
