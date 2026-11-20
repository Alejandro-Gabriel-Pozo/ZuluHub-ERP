import type { CATALOGO_DE_MODULOS } from "../modulos/catalogo";
import type { RolDeEmpresa } from "./roles";

export const PERMISOS_DE_CLIENTES = {
  // E9-T1 (e9-compras-especificacion §3.9). Los dos módulos están `en_desarrollo`: el guard rechaza todo antes de mirar
  // esta tabla. Directorio (F1, decidido): el operador busca, da de alta y edita; desactivar y reactivar, no.
  "partes.ver": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "partes.crear": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "partes.editar": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "partes.cambiar_roles": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "partes.vincular_contacto": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "partes.desvincular_contacto": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "partes.desactivar": ["GERENTE", "ADMINISTRADOR"],
  "partes.reactivar": ["GERENTE", "ADMINISTRADOR"],
} as const satisfies Record<
  keyof (typeof CATALOGO_DE_MODULOS)["clientes"]["acciones"],
  readonly RolDeEmpresa[]
>;
