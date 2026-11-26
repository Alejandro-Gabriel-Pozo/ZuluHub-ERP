/**
 * ARCHIVO CENTRAL
 * QUÉ ES: la matriz rol → acciones de la empresa, armada con lo que aporta cada módulo.
 * QUÉ NO ES: el lugar donde se listan las acciones de un módulo.
 * EXPORTA: PERMISOS_DE_EMPRESA, ReglasDeEmpresa, REGLAS_DE_EMPRESA, tablaDePermisos
 * IMPORTA: src/capacidades/permisos/permisos-de-*, src/capacidades/modulos/catalogo, src/capacidades/modulos/activos, src/capacidades/permisos/guard, src/capacidades/permisos/roles.
 * PARTE DEDICADA: src/capacidades/permisos/permisos-de-<módulo>.ts (las filas de cada módulo van ahí).
 */
import { clavesDe } from "../modulos/activos";
import {
  CATALOGO_DE_MODULOS,
  type ClaveAccion,
  type ClaveCapacidad,
  type ClaveModulo,
} from "../modulos/catalogo";
import type { ReglasDelGuard } from "./guard";
import { PERMISOS_DE_ADMINISTRACION } from "./permisos-de-administracion";
import { PERMISOS_DE_CAJA } from "./permisos-de-caja";
import { PERMISOS_DE_CATALOGO } from "./permisos-de-catalogo";
import { PERMISOS_DE_CIERRE } from "./permisos-de-cierre";
import { PERMISOS_DE_CLIENTES } from "./permisos-de-clientes";
import { PERMISOS_DE_COMANDAS } from "./permisos-de-comandas";
import { PERMISOS_DE_COMPRAS } from "./permisos-de-compras";
import { PERMISOS_DE_CUENTA_CORRIENTE } from "./permisos-de-cuenta_corriente";
import { PERMISOS_DE_FACTURACION } from "./permisos-de-facturacion";
import { PERMISOS_DE_PRODUCCION } from "./permisos-de-produccion";
import { PERMISOS_DE_SALON } from "./permisos-de-salon";
import { PERMISOS_DE_STOCK } from "./permisos-de-stock";
import { PERMISOS_DE_VENTAS } from "./permisos-de-ventas";
import { PERMISOS_DE_VIDRIERA } from "./permisos-de-vidriera";
import type { RolDeEmpresa, RolDeLaMembresia as Rol } from "./roles";

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
  ...PERMISOS_DE_ADMINISTRACION,
  ...PERMISOS_DE_FACTURACION,
  ...PERMISOS_DE_CATALOGO,
  ...PERMISOS_DE_VIDRIERA,
  ...PERMISOS_DE_STOCK,
  ...PERMISOS_DE_CAJA,
  ...PERMISOS_DE_CIERRE,
  ...PERMISOS_DE_VENTAS,
  ...PERMISOS_DE_COMANDAS,
  ...PERMISOS_DE_SALON,
  ...PERMISOS_DE_CLIENTES,
  ...PERMISOS_DE_COMPRAS,
  ...PERMISOS_DE_CUENTA_CORRIENTE,
  ...PERMISOS_DE_PRODUCCION,
} as const satisfies Record<ClaveAccion, readonly RolDeEmpresa[]>;

export type ReglasDeEmpresa = ReglasDelGuard<ClaveModulo, ClaveAccion, ClaveCapacidad, Rol>;

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
