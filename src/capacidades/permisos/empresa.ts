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
 *
 * H6 (especificación §B.4, preguntas F1 y F4): las sucursales las ven, crean y editan el gerente y
 * el administrador, pero desactivarlas y reactivarlas es solo del gerente; proponer y cancelar el
 * traspaso de gerencia, también. Aceptar, rechazar y ver un traspaso son de los tres roles: quien
 * responde es el entrante, que puede ser un operador, y el dominio exige que el actor sea él. Cada
 * acción cumple el piso jerárquico: lo que puede el operador lo puede el administrador, y lo del
 * administrador, el gerente.
 */
export const PERMISOS_DE_EMPRESA = {
  "usuarios.invitar": ["GERENTE", "ADMINISTRADOR"],
  "usuarios.reenviar_invitacion": ["GERENTE", "ADMINISTRADOR"],
  "usuarios.apagar": ["GERENTE", "ADMINISTRADOR"],
  "usuarios.ver": ["GERENTE", "ADMINISTRADOR"],
  "usuarios.asignar_sucursales": ["GERENTE", "ADMINISTRADOR"],
  "usuarios.revocar_invitacion": ["GERENTE", "ADMINISTRADOR"],
  "sucursales.ver": ["GERENTE", "ADMINISTRADOR"],
  "sucursales.crear": ["GERENTE", "ADMINISTRADOR"],
  "sucursales.editar": ["GERENTE", "ADMINISTRADOR"],
  "sucursales.desactivar": ["GERENTE"],
  "sucursales.reactivar": ["GERENTE"],
  "gerencia.proponer_traspaso": ["GERENTE"],
  "gerencia.cancelar_traspaso": ["GERENTE"],
  "gerencia.ver_traspaso": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "gerencia.aceptar_traspaso": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "gerencia.rechazar_traspaso": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "modulos.ver": ["GERENTE", "ADMINISTRADOR"],
  "permisos.ver_propios": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  // H7 (especificación §C): quien cobra puede emitir el comprobante en el mismo acto, los tres roles.
  "comprobantes.emitir": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
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
