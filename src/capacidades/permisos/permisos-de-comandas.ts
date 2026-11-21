import type { CATALOGO_DE_MODULOS } from "../modulos/catalogo";
import type { RolDeEmpresa } from "./roles";

export const PERMISOS_DE_COMANDAS = {
  // E7 (spec §3.13, PP-2 decidido por el padre el 10/11/2026): unir, dividir, cambiar de mesa, enviar a cocina e imprimir, los tres roles con todo
  // auditado (como la decisión 155); armar el plano de mesas y las impresoras, el gerente y el administrador (el operador solo las mira).
  "comandas.ver": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "comandas.enviar": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "impresiones.imprimir": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "impresiones.reimprimir": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "impresoras.ver": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "impresoras.crear": ["GERENTE", "ADMINISTRADOR"],
  "impresoras.editar": ["GERENTE", "ADMINISTRADOR"],
  "impresoras.desactivar": ["GERENTE", "ADMINISTRADOR"],
} as const satisfies Record<
  keyof (typeof CATALOGO_DE_MODULOS)["comandas"]["acciones"],
  readonly RolDeEmpresa[]
>;
