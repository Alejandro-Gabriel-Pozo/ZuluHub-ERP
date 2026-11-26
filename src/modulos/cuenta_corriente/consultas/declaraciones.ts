import type { DeclaracionDeCaso } from "../../../capacidades/permisos/declaracion";

/** Las consultas de la cuenta corriente de clientes (ADR-005) y la acción que cada una exige al guard (cruce X1 de ADR-003). */
export const DECLARACIONES_DE_CONSULTAS = {
  verCuentaDelCliente: { accion: "cuenta_corriente.ver" },
} as const satisfies Record<string, DeclaracionDeCaso>;
