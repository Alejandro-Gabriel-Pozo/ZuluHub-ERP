import type { CATALOGO_DE_MODULOS } from "../modulos/catalogo";
import type { RolDeEmpresa } from "./roles";

export const PERMISOS_DE_VIDRIERA = {
  // Catálogo, carta y stock (catalogo-y-stock §C, T0; propuesta A de F6, F7 e I.4, pendientes de
  // veto del dueño). El operador mira, marca «agotado», mueve stock y cuenta en sus sucursales (el
  // alcance lo verifica el caso de uso con `exigirSucursal`); definir el catálogo, los precios, las
  // opciones y la carta, corregir stock y exponer la carta a internet es del gerente y el
  // administrador; lo que toca la estructura fiscal o la verificación de saldos es solo del gerente.
  "vidrieras.ver": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "vidrieras.marcar_disponibilidad": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "vidrieras.crear": ["GERENTE", "ADMINISTRADOR"],
  "vidrieras.editar": ["GERENTE", "ADMINISTRADOR"],
  "vidrieras.ocultar_en_empresa": ["GERENTE", "ADMINISTRADOR"],
  "vidrieras.publicar": ["GERENTE", "ADMINISTRADOR"],
  "vidrieras.retirar": ["GERENTE", "ADMINISTRADOR"],
  // E6 (T8, P-2, DEC-0101): producción. Mirar y abrir una orden, los tres roles; cerrar, cancelar y anular (deshacer stock y costo), gerente y administrador.
  // Cerrar: decisión del dueño del 14/11/2026 (auditoría Q10, DEC-0430): el operador carga la orden pero no la cierra.
  "vidrieras.publicar_en_linea": ["GERENTE", "ADMINISTRADOR"],
  "vidrieras.renovar_enlace": ["GERENTE", "ADMINISTRADOR"],
  "vidrieras.retirar_de_linea": ["GERENTE", "ADMINISTRADOR"],
  "vidrieras.administrar_portal": ["GERENTE", "ADMINISTRADOR"],
} as const satisfies Record<
  keyof (typeof CATALOGO_DE_MODULOS)["vidriera"]["acciones"],
  readonly RolDeEmpresa[]
>;
