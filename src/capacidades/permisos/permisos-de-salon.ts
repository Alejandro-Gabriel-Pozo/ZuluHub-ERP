import type { CATALOGO_DE_MODULOS } from "../modulos/catalogo";
import type { RolDeEmpresa } from "./roles";

export const PERMISOS_DE_SALON = {
  // E7 (spec §3.13, PP-2 decidido por el padre el 10/11/2026): unir, dividir, cambiar de mesa, enviar a cocina e imprimir, los tres roles con todo
  // auditado (como la decisión 155); armar el plano de mesas y las impresoras, el gerente y el administrador (el operador solo las mira).
  "mesas.ver": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "mesas.crear": ["GERENTE", "ADMINISTRADOR"],
  "mesas.editar": ["GERENTE", "ADMINISTRADOR"],
  "mesas.reactivar": ["GERENTE", "ADMINISTRADOR"],
  "mesas.desactivar": ["GERENTE", "ADMINISTRADOR"],
  "salon.cambiar_mesa": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "salon.unir": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "salon.dividir": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
} as const satisfies Record<
  keyof (typeof CATALOGO_DE_MODULOS)["salon"]["acciones"],
  readonly RolDeEmpresa[]
>;
