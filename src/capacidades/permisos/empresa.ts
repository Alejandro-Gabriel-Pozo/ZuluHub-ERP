import { clavesDe } from "../modulos/activos";
import {
  CATALOGO_DE_MODULOS,
  type ClaveAccion,
  type ClaveCapacidad,
  type ClaveModulo,
} from "../modulos/catalogo";
import type { ReglasDelGuard } from "./guard";
import type { RolDeEmpresa } from "./roles";

/**
 * Qué puede hacer cada rol dentro de una empresa. Es una TABLA DE DATOS en el código (roles fijos
 * para todas las empresas, decisión 18), no lógica: el guard la recibe como parámetro. Si falta una
 * acción del catálogo, o sobra una que no existe, o aparece un rol que no existe, no compila.
 *
 * Usuarios (decisión 2, diseño §6.3): el gerente y el administrador gestionan usuarios por igual,
 * incluido invitar o apagar a otro administrador; el operador no gestiona ninguno.
 */
export const PERMISOS_DE_EMPRESA = {
  "usuarios.invitar": ["GERENTE", "ADMINISTRADOR"],
  "usuarios.reenviar_invitacion": ["GERENTE", "ADMINISTRADOR"],
  "usuarios.apagar": ["GERENTE", "ADMINISTRADOR"],
} as const satisfies Record<ClaveAccion, readonly RolDeEmpresa[]>;

export type ReglasDeEmpresa = ReglasDelGuard<ClaveModulo, ClaveAccion, ClaveCapacidad>;

/** El catálogo y la matriz reales, tal como la composición se los pasa a los casos de uso. */
export const REGLAS_DE_EMPRESA: ReglasDeEmpresa = {
  catalogo: CATALOGO_DE_MODULOS,
  permisos: PERMISOS_DE_EMPRESA,
};

/** La matriz leída por rol: qué acciones (ordenadas) puede cada uno. Sirve para verla y compararla. */
export function tablaDePermisos<A extends string>(
  permisos: Readonly<Record<A, readonly RolDeEmpresa[]>>,
): Readonly<Record<RolDeEmpresa, readonly A[]>> {
  const de = (rol: RolDeEmpresa): A[] =>
    clavesDe(permisos)
      .filter((a) => permisos[a].includes(rol))
      .sort();
  return { GERENTE: de("GERENTE"), ADMINISTRADOR: de("ADMINISTRADOR"), OPERADOR: de("OPERADOR") };
}
