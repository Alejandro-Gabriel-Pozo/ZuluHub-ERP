import type { DeclaracionDeCaso } from "../../../capacidades/permisos/declaracion";

/**
 * Las consultas por pantalla de identidad (ADR-005) y la acción que cada una exige al guard (cruce
 * X1 de ADR-003). Una consulta pide su acción igual que un caso de uso, dentro de su transacción.
 * Se declaran todas en el tramo T0 para que los tramos paralelos no se pisen; cada consulta se
 * implementa en su tramo (T3a: miembros e invitaciones; T4: traspaso).
 */
export const DECLARACIONES_DE_CONSULTAS = {
  listarMiembros: { accion: "usuarios.ver" },
  listarInvitacionesPendientes: { accion: "usuarios.ver" },
  traspasoEnCurso: { accion: "gerencia.ver_traspaso" },
} as const satisfies Record<string, DeclaracionDeCaso>;
