import type { CATALOGO_DE_MODULOS } from "../modulos/catalogo";
import type { RolDeEmpresa } from "./roles";

export const PERMISOS_DE_CIERRE = {
  // Cierre del día (e3b §3.6, decisión 161): los tres roles, en solo lectura se permiten las que cierran.
  "jornadas.ver": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "jornadas.iniciar_auditoria": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "jornadas.cancelar_auditoria": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "jornadas.cerrar": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
} as const satisfies Record<
  keyof (typeof CATALOGO_DE_MODULOS)["cierre"]["acciones"],
  readonly RolDeEmpresa[]
>;
