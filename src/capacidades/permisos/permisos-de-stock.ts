import type { CATALOGO_DE_MODULOS } from "../modulos/catalogo";
import type { RolDeEmpresa } from "./roles";

export const PERMISOS_DE_STOCK = {
  // Catálogo, carta y stock (catalogo-y-stock §C, T0; propuesta A de F6, F7 e I.4, pendientes de
  // veto del dueño). El operador mira, marca «agotado», mueve stock y cuenta en sus sucursales (el
  // alcance lo verifica el caso de uso con `exigirSucursal`); definir el catálogo, los precios, las
  // opciones y la carta, corregir stock y exponer la carta a internet es del gerente y el
  // administrador; lo que toca la estructura fiscal o la verificación de saldos es solo del gerente.
  "stock.ver": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "stock.registrar_entrada": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "stock.registrar_salida": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "stock.transferir": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "conteos.registrar": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
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
  // E6 (T8, P-2, DEC-0101): producción. Mirar y abrir una orden, los tres roles; cerrar, cancelar y anular (deshacer stock y costo), gerente y administrador.
  // Cerrar: decisión del dueño del 14/11/2026 (auditoría Q10, DEC-0430): el operador carga la orden pero no la cierra.
  "depositos.desactivar": ["GERENTE", "ADMINISTRADOR"],
  "articulos.dejar_de_controlar": ["GERENTE", "ADMINISTRADOR"],
  "stock.ajustar": ["GERENTE", "ADMINISTRADOR"],
  "conteos.abrir": ["GERENTE", "ADMINISTRADOR"],
  "stock.anular": ["GERENTE", "ADMINISTRADOR"],
  "conteos.aplicar": ["GERENTE", "ADMINISTRADOR"],
  "conteos.cancelar": ["GERENTE", "ADMINISTRADOR"],
  "stock.verificar_saldos": ["GERENTE"],
  // E5-T10 (P-1, DECIDIDO: e5-stock-especificacion §8): ver costos, de gerente y administrador; el operador no los ve nunca.
  "costos.ver": ["GERENTE", "ADMINISTRADOR"],
} as const satisfies Record<
  keyof (typeof CATALOGO_DE_MODULOS)["stock"]["acciones"],
  readonly RolDeEmpresa[]
>;
