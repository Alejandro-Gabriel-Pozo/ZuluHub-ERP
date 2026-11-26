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
  // H4b T4: los roles propios (solo el gerente).
  listarRoles: { accion: "roles.ver" },
  verRol: { accion: "roles.ver" },
  rolesAsignables: { accion: "usuarios.asignar_rol" },
  // El correo con que se muestra a una persona en historiales y listas de cualquier pantalla: los tres roles (como `sucursalesElegibles`, es lo propio de quien opera,
  // no administración). SUPUESTO DEC-0464: la acción es la misma que la de las sucursales elegibles; el alcance es la empresa del contexto.
  personasParaMostrar: { accion: "permisos.ver_propios" },
} as const satisfies Record<string, DeclaracionDeCaso>;
