import type { CATALOGO_DE_MODULOS } from "../modulos/catalogo";
import type { RolDeEmpresa } from "./roles";

export const PERMISOS_DE_CAJA = {
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
} as const satisfies Record<
  keyof (typeof CATALOGO_DE_MODULOS)["caja"]["acciones"],
  readonly RolDeEmpresa[]
>;
