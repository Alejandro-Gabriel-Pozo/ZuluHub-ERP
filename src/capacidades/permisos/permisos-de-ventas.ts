import type { CATALOGO_DE_MODULOS } from "../modulos/catalogo";
import type { RolDeEmpresa } from "./roles";

export const PERMISOS_DE_VENTAS = {
  // Ventas (e4 §3.14, tabla exacta de S4). Anular línea, anular cuenta y corregir ticket: decisión 155, el operador
  // puede, todo auditado.
  "ventas.ver": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "cuentas.abrir": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "cuentas.agregar_linea": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "cuentas.cerrar": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "cuentas.anular_linea": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "cuentas.anular": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "tickets.cobrar": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "tickets.corregir": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
} as const satisfies Record<
  keyof (typeof CATALOGO_DE_MODULOS)["ventas"]["acciones"],
  readonly RolDeEmpresa[]
>;
