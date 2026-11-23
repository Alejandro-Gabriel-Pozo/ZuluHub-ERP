import type { CATALOGO_DE_MODULOS } from "../modulos/catalogo";
import type { RolDeEmpresa } from "./roles";

export const PERMISOS_DE_PRODUCCION = {
  // E6 (T8, P-2, DEC-0101): producción. Mirar y abrir una orden, los tres roles; cerrar, cancelar y anular (deshacer stock y costo), gerente y administrador.
  // Cerrar: decisión del dueño del 14/11/2026 (auditoría Q10, DEC-0430): el operador carga la orden pero no la cierra.
  "transformaciones.ver": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "transformaciones.abrir": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "transformaciones.cerrar": ["GERENTE", "ADMINISTRADOR"],
  "transformaciones.cancelar": ["GERENTE", "ADMINISTRADOR"],
  "transformaciones.anular": ["GERENTE", "ADMINISTRADOR"],
} as const satisfies Record<
  keyof (typeof CATALOGO_DE_MODULOS)["produccion"]["acciones"],
  readonly RolDeEmpresa[]
>;
