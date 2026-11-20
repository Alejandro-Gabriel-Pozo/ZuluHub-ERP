import type { CATALOGO_DE_MODULOS } from "../modulos/catalogo";
import type { RolDeEmpresa } from "./roles";

export const PERMISOS_DE_CATALOGO = {
  // Catálogo, carta y stock (catalogo-y-stock §C, T0; propuesta A de F6, F7 e I.4, pendientes de
  // veto del dueño). El operador mira, marca «agotado», mueve stock y cuenta en sus sucursales (el
  // alcance lo verifica el caso de uso con `exigirSucursal`); definir el catálogo, los precios, las
  // opciones y la carta, corregir stock y exponer la carta a internet es del gerente y el
  // administrador; lo que toca la estructura fiscal o la verificación de saldos es solo del gerente.
  "productos.ver": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "productos.crear": ["GERENTE", "ADMINISTRADOR"],
  "productos.editar": ["GERENTE", "ADMINISTRADOR"],
  "productos.reactivar": ["GERENTE", "ADMINISTRADOR"],
  "productos.cambiar_precio": ["GERENTE", "ADMINISTRADOR"],
  "opciones.editar": ["GERENTE", "ADMINISTRADOR"],
  "productos.desactivar": ["GERENTE", "ADMINISTRADOR"],
  "categorias.crear": ["GERENTE", "ADMINISTRADOR"],
  "categorias.editar": ["GERENTE", "ADMINISTRADOR"],
  "categorias.reactivar": ["GERENTE", "ADMINISTRADOR"],
  "categorias.desactivar": ["GERENTE", "ADMINISTRADOR"],
  // E6 (T8, P-2, DEC-0101): producción. Mirar y abrir una orden, los tres roles; cerrar, cancelar y anular (deshacer stock y costo), gerente y administrador.
  // Cerrar: decisión del dueño del 14/11/2026 (auditoría Q10, DEC-0430): el operador carga la orden pero no la cierra.
  "productos.asignar_emisor": ["GERENTE"],
  // CE0 (catalogo-carta-niveles-y-elecciones §7.2): quien carga productos y opciones también edita las
  // variantes y los combos (F6, opción A). El operador no. Sin acciones de grupos de precio ni
  // `opciones.asignar` (decisiones 138 y 133).
  "variantes.editar": ["GERENTE", "ADMINISTRADOR"],
  "conjuntos.editar_contenido": ["GERENTE", "ADMINISTRADOR"],
} as const satisfies Record<
  keyof (typeof CATALOGO_DE_MODULOS)["catalogo"]["acciones"],
  readonly RolDeEmpresa[]
>;
