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
  // Catálogo, carta y stock (catalogo-y-stock §C, T0; propuesta A de F6, F7 e I.4, pendientes de
  // veto del dueño). El operador mira, marca «agotado», mueve stock y cuenta en sus sucursales (el
  // alcance lo verifica el caso de uso con `exigirSucursal`); definir el catálogo, los precios, las
  // opciones y la carta, corregir stock y exponer la carta a internet es del gerente y el
  // administrador; lo que toca la estructura fiscal o la verificación de saldos es solo del gerente.
  "productos.ver": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "cartas.ver": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "stock.ver": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "cartas.marcar_disponibilidad": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "stock.registrar_entrada": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "stock.registrar_salida": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "stock.transferir": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "conteos.registrar": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "productos.crear": ["GERENTE", "ADMINISTRADOR"],
  "productos.editar": ["GERENTE", "ADMINISTRADOR"],
  "productos.reactivar": ["GERENTE", "ADMINISTRADOR"],
  "productos.cambiar_precio": ["GERENTE", "ADMINISTRADOR"],
  "opciones.editar": ["GERENTE", "ADMINISTRADOR"],
  "productos.desactivar": ["GERENTE", "ADMINISTRADOR"],
  "categorias.crear": ["GERENTE", "ADMINISTRADOR"],
  "categorias.editar": ["GERENTE", "ADMINISTRADOR"],
  "categorias.reactivar": ["GERENTE", "ADMINISTRADOR"],
  "cartas.crear": ["GERENTE", "ADMINISTRADOR"],
  "cartas.editar": ["GERENTE", "ADMINISTRADOR"],
  "cartas.publicar": ["GERENTE", "ADMINISTRADOR"],
  "categorias.desactivar": ["GERENTE", "ADMINISTRADOR"],
  "cartas.retirar": ["GERENTE", "ADMINISTRADOR"],
  "depositos.crear": ["GERENTE", "ADMINISTRADOR"],
  "depositos.editar": ["GERENTE", "ADMINISTRADOR"],
  "depositos.reactivar": ["GERENTE", "ADMINISTRADOR"],
  "articulos.controlar": ["GERENTE", "ADMINISTRADOR"],
  "recetas.editar": ["GERENTE", "ADMINISTRADOR"],
  "depositos.desactivar": ["GERENTE", "ADMINISTRADOR"],
  "articulos.dejar_de_controlar": ["GERENTE", "ADMINISTRADOR"],
  "stock.ajustar": ["GERENTE", "ADMINISTRADOR"],
  "conteos.abrir": ["GERENTE", "ADMINISTRADOR"],
  "stock.anular": ["GERENTE", "ADMINISTRADOR"],
  "conteos.aplicar": ["GERENTE", "ADMINISTRADOR"],
  "conteos.cancelar": ["GERENTE", "ADMINISTRADOR"],
  "cartas.publicar_en_linea": ["GERENTE", "ADMINISTRADOR"],
  "cartas.renovar_enlace": ["GERENTE", "ADMINISTRADOR"],
  "cartas.retirar_de_linea": ["GERENTE", "ADMINISTRADOR"],
  "productos.asignar_emisor": ["GERENTE"],
  "depositos.asignar_emisor": ["GERENTE"],
  "stock.verificar_saldos": ["GERENTE"],
  // CE0 (catalogo-carta-niveles-y-elecciones §7.2): quien carga productos y opciones también edita las
  // variantes, arma la biblioteca de elecciones, los grupos de precio y los combos (F6, opción A). El
  // operador no.
  "variantes.editar": ["GERENTE", "ADMINISTRADOR"],
  "opciones.asignar": ["GERENTE", "ADMINISTRADOR"],
  "grupos_de_precio.crear": ["GERENTE", "ADMINISTRADOR"],
  "grupos_de_precio.editar": ["GERENTE", "ADMINISTRADOR"],
  "grupos_de_precio.asignar": ["GERENTE", "ADMINISTRADOR"],
  "grupos_de_precio.desactivar": ["GERENTE", "ADMINISTRADOR"],
  "grupos_de_precio.reactivar": ["GERENTE", "ADMINISTRADOR"],
  "combos.editar_contenido": ["GERENTE", "ADMINISTRADOR"],
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
