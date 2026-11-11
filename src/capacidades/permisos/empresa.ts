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
  // H7 fiscal §C (T5), DECIDIDO (C11): la configuración fiscal es solo del gerente, igual que certificados. El
  // administrador y el operador ni confirman datos fiscales ni activan puntos de venta.
  "datos_fiscales.editar": ["GERENTE"],
  "datos_fiscales.confirmar": ["GERENTE"],
  "puntos_de_venta.crear": ["GERENTE"],
  "puntos_de_venta.editar": ["GERENTE"],
  "puntos_de_venta.activar": ["GERENTE"],
  "puntos_de_venta.desactivar": ["GERENTE"],
  "emisores.confirmar_regla": ["GERENTE"],
  // H7 (especificación §C): quien cobra puede emitir el comprobante en el mismo acto, los tres roles.
  "comprobantes.emitir": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  // H7 facturación §B.4.9 (F6): las consultas del facturador; mirar lo emitido lo pueden los tres roles.
  "comprobantes.ver": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  // Catálogo, carta y stock (catalogo-y-stock §C, T0; propuesta A de F6, F7 e I.4, pendientes de
  // veto del dueño). El operador mira, marca «agotado», mueve stock y cuenta en sus sucursales (el
  // alcance lo verifica el caso de uso con `exigirSucursal`); definir el catálogo, los precios, las
  // opciones y la carta, corregir stock y exponer la carta a internet es del gerente y el
  // administrador; lo que toca la estructura fiscal o la verificación de saldos es solo del gerente.
  "productos.ver": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "vidrieras.ver": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "stock.ver": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "vidrieras.marcar_disponibilidad": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
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
  "vidrieras.crear": ["GERENTE", "ADMINISTRADOR"],
  "vidrieras.editar": ["GERENTE", "ADMINISTRADOR"],
  "vidrieras.publicar": ["GERENTE", "ADMINISTRADOR"],
  "categorias.desactivar": ["GERENTE", "ADMINISTRADOR"],
  "vidrieras.retirar": ["GERENTE", "ADMINISTRADOR"],
  "depositos.crear": ["GERENTE", "ADMINISTRADOR"],
  "depositos.editar": ["GERENTE", "ADMINISTRADOR"],
  "depositos.reactivar": ["GERENTE", "ADMINISTRADOR"],
  "articulos.controlar": ["GERENTE", "ADMINISTRADOR"],
  "composiciones.editar": ["GERENTE", "ADMINISTRADOR"],
  // E6 (T7, P-2): lotes y calidad. Mirar lo ven los tres; el resto, gerente y administrador.
  "lotes.ver": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "lotes.controlar": ["GERENTE", "ADMINISTRADOR"],
  "lotes.dejar_de_controlar": ["GERENTE", "ADMINISTRADOR"],
  "lotes.cambiar_calidad": ["GERENTE", "ADMINISTRADOR"],
  "lotes.corregir": ["GERENTE", "ADMINISTRADOR"],
  "lotes.reasignar": ["GERENTE", "ADMINISTRADOR"],
  // E6 (T8, P-2, DEC-0101): producción. Mirar, abrir y cerrar una orden, los tres roles; cancelar y anular (deshacer stock y costo), gerente y administrador.
  "transformaciones.ver": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "transformaciones.abrir": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "transformaciones.cerrar": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "transformaciones.cancelar": ["GERENTE", "ADMINISTRADOR"],
  "transformaciones.anular": ["GERENTE", "ADMINISTRADOR"],
  "depositos.desactivar": ["GERENTE", "ADMINISTRADOR"],
  "articulos.dejar_de_controlar": ["GERENTE", "ADMINISTRADOR"],
  "stock.ajustar": ["GERENTE", "ADMINISTRADOR"],
  "conteos.abrir": ["GERENTE", "ADMINISTRADOR"],
  "stock.anular": ["GERENTE", "ADMINISTRADOR"],
  "conteos.aplicar": ["GERENTE", "ADMINISTRADOR"],
  "conteos.cancelar": ["GERENTE", "ADMINISTRADOR"],
  "vidrieras.publicar_en_linea": ["GERENTE", "ADMINISTRADOR"],
  "vidrieras.renovar_enlace": ["GERENTE", "ADMINISTRADOR"],
  "vidrieras.retirar_de_linea": ["GERENTE", "ADMINISTRADOR"],
  "productos.asignar_emisor": ["GERENTE"],
  "stock.verificar_saldos": ["GERENTE"],
  // E5-T10 (P-1, DECIDIDO: e5-stock-especificacion §8): ver costos, de gerente y administrador; el operador no los ve nunca.
  "costos.ver": ["GERENTE", "ADMINISTRADOR"],
  // CE0 (catalogo-carta-niveles-y-elecciones §7.2): quien carga productos y opciones también edita las
  // variantes y los combos (F6, opción A). El operador no. Sin acciones de grupos de precio ni
  // `opciones.asignar` (decisiones 138 y 133).
  "variantes.editar": ["GERENTE", "ADMINISTRADOR"],
  "conjuntos.editar_contenido": ["GERENTE", "ADMINISTRADOR"],
  // H7 facturación §C (F5). Emitir a mano (P10, DECIDIDO), la nota de crédito (P9, recomendada A), descartar y
  // reintentar (ASUMIDO): los tres roles. Resincronizar una serie (QF1) y cambiar el ambiente de un punto de venta
  // (QF2): solo el gerente (DECIDIDO, dueño 2026-10-13).
  "comprobantes.emitir_manual": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "notas_de_credito.emitir": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "comprobantes.descartar": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "comprobantes.reintentar": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "series.resincronizar": ["GERENTE"],
  "puntos_de_venta.cambiar_ambiente": ["GERENTE"],
  // H7 facturación §C (F7), DECIDIDO: solo el gerente genera el pedido y carga el certificado de ARCA.
  "certificados.gestionar": ["GERENTE"],
  // E0-T1 (e0-cimientos-especificacion §3.1). Los tres módulos están `en_desarrollo`: el guard rechaza todo antes de
  // mirar esta tabla, así que estas filas no dan permiso a nadie hasta que E3, E3b y E4 los construyan. Roles fijos
  // (decisión 18); el operador hace el cierre del día (161) y anula y corrige con todo auditado (155).
  // Caja (e3 §3.8 y e3b §4.7; fuente de cada fila: `e0-cimientos-especificacion.md` §3.1.1). Las cajas adicionales las
  // habilita el plan y las crea el gerente (decisión 124).
  "cajas.ver": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "cajas.crear": ["GERENTE"],
  "cajas.reactivar": ["GERENTE"],
  "cajas.desactivar": ["GERENTE"],
  "cajas.editar": ["GERENTE", "ADMINISTRADOR"],
  // Medios de pago y cuentas de cobro (decisión 124); `medios_de_pago.editar` cubre elegir qué datos opcionales
  // pide cada medio (decisión 129, SUPUESTO (DEC-0056) S-2).
  "medios_de_pago.crear": ["GERENTE", "ADMINISTRADOR"],
  "medios_de_pago.editar": ["GERENTE", "ADMINISTRADOR"],
  "medios_de_pago.reactivar": ["GERENTE", "ADMINISTRADOR"],
  "medios_de_pago.desactivar": ["GERENTE", "ADMINISTRADOR"],
  "cuentas_de_cobro.crear": ["GERENTE", "ADMINISTRADOR"],
  "cuentas_de_cobro.editar": ["GERENTE", "ADMINISTRADOR"],
  "cuentas_de_cobro.reactivar": ["GERENTE", "ADMINISTRADOR"],
  "cuentas_de_cobro.desactivar": ["GERENTE", "ADMINISTRADOR"],
  // Sesiones de caja: decisión 123 (fondo declarado) y 145 (el operador debe poder abrirla). Iniciar y cancelar el
  // cierre: la 123 no los menciona, lo confirma E3.
  "sesiones_caja.abrir": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "sesiones_caja.iniciar_cierre": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "sesiones_caja.cancelar_cierre": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "sesiones_caja.cerrar": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  // Movimientos manuales (decisión 123): el ajuste es de quien administra o gerencia; el operador anula solo lo suyo
  // (lo valida el caso de uso).
  "movimientos_caja.registrar_manual": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "movimientos_caja.ajustar": ["GERENTE", "ADMINISTRADOR"],
  "movimientos_caja.anular": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "movimientos_caja.anular_de_otros": ["GERENTE", "ADMINISTRADOR"],
  // e3b §4.7 y decisión 161: los tres roles.
  "cobros.corregir_medio": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "declaraciones_de_total.registrar": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  // Cierre del día (e3b §3.6, decisión 161): los tres roles, en solo lectura se permiten las que cierran.
  "jornadas.ver": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "jornadas.iniciar_auditoria": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "jornadas.cancelar_auditoria": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "jornadas.cerrar": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
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
  // Compras (P-3, DECIDIDO por el padre el 10/11/2026, corregible): el operador carga la compra y la factura y pide
  // puntos de venta o comprobantes; no paga, no anula, no corrige ni configura. Aprobar la ficha es de quien administra
  // (D111); el nivel de operación es solo del gerente.
  "proveedores.editar_ficha": ["GERENTE", "ADMINISTRADOR"],
  "proveedores.pedir_ficha": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "recepciones.ver": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "recepciones.registrar": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "recepciones.anular": ["GERENTE", "ADMINISTRADOR"],
  "comprobantes_de_proveedor.ver": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "comprobantes_de_proveedor.registrar": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "comprobantes_de_proveedor.pagar": ["GERENTE", "ADMINISTRADOR"],
  "comprobantes_de_proveedor.anular_pago": ["GERENTE", "ADMINISTRADOR"],
  "compras.configurar": ["GERENTE"],
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
