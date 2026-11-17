import type { DeclaracionDeCaso } from "../../../capacidades/permisos/declaracion";

/**
 * Las consultas por pantalla del directorio (ADR-005; E9 §3.1) y la acción que cada una exige al guard (cruce X1). Mirar es de los tres roles (F1: el
 * operador busca y ve las fichas). Filtran por la empresa del contexto, que resuelve el servidor.
 */
export const DECLARACIONES_DE_CONSULTAS = {
  buscarPartes: { accion: "partes.ver" },
  fichaDeParte: { accion: "partes.ver" },
  posiblesDuplicados: { accion: "partes.ver" },
} as const satisfies Record<string, DeclaracionDeCaso>;
