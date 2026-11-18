import "server-only";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { texto } from "../../../src/capacidades/vocabulario/vocabulario";
import type { ClaveAccion } from "../../../src/capacidades/modulos/catalogo";
import type {
  AccionesDePuntosDeVenta,
  OfertaDeAccion,
} from "../ui/plantillas/configuracion-fiscal/modelo-de-puntos-de-venta";
import { ofertaDe, permisosDeLaPersona } from "./permisos-de-la-persona";

/**
 * ¿La persona puede editar el contacto de la sucursal (D-113)? Es la oferta de `sucursales.editar` (gerente y administrador) que el
 * servidor calcula con `ofertaDe`: con el módulo en solo lectura o sin el rol, no. Si no se pudieron leer los permisos, `false`
 * (cierra, no abre). Ocultar no es autorizar: la ficha y el guardado vuelven a pasar por el guard. Chequeo:
 * `test/web/contacto-de-sucursal-acceso.test.ts`.
 */
export async function puedeEditarElContactoDeLaSucursal(
  contexto: ContextoOperativo,
): Promise<boolean> {
  const permisos = await permisosDeLaPersona(contexto);
  return permisos !== null && ofertaDe("sucursales.editar", permisos).permitida;
}

/**
 * Qué botones de Puntos de venta se ofrecen activos hoy, según lo que el SERVIDOR deja hacer (`permisosDelActor`, una lectura por
 * pedido). «Pasar a producción» (`puntos_de_venta.cambiar_ambiente`) es del módulo `facturacion` (`disponible` desde 2026-11-04, pero
 * activo solo en las empresas donde la plataforma lo activó): sale apagado, con el motivo que da el servidor, si el módulo no está activo
 * para la empresa o el rol no alcanza; las demás son de `administracion`. Si no se pudieron leer los permisos, TODO sale apagado
 * con el genérico de D-82, «Esta acción no está permitida.» (ante un error o una duda el sistema cierra, `CLAUDE.md`; igual que
 * `puedeEmitirNotasDeCredito` y la barra).
 * Previene: ofrecer un botón que el guard va a rechazar sin saber si la persona puede. Es solo una ayuda: ocultar o apagar no es
 * autorizar, cada acción vuelve a pasar por el guard dentro de su transacción.
 */
export async function accionesDePuntosDeVenta(
  contexto: ContextoOperativo,
): Promise<AccionesDePuntosDeVenta> {
  const permisos = await permisosDeLaPersona(contexto);
  const de = (accion: ClaveAccion): OfertaDeAccion =>
    permisos === null
      ? { permitida: false, motivo: texto({}, "fiscal.pantalla.config_pv_accion_no_permitida") }
      : ofertaDe(accion, permisos);
  return {
    agregar: de("puntos_de_venta.crear"),
    editar: de("puntos_de_venta.editar"),
    activar: de("puntos_de_venta.activar"),
    desactivar: de("puntos_de_venta.desactivar"),
    pasarAProduccion: de("puntos_de_venta.cambiar_ambiente"),
  };
}
