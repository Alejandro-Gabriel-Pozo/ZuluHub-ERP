import "server-only";
/**
 * Parte dedicada de `modulos.ts` (archivo central, ver su encabezado): las ofertas de botones del módulo producción: la ficha de una orden.
 */
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import type { AccionesDeLaOrden } from "../ui/plantillas/produccion/modelo-de-orden";
import { puedeLaAccion } from "./permisos-de-la-persona";

/**
 * Qué botones de la ficha de una orden de producción se ofrecen hoy: «Cancelar la orden» (`transformaciones.cancelar`) y «Anular la orden» (`transformaciones.anular`), solo gerente y
 * administrador (el operador abre y mira). Es la oferta que el servidor calcula con `ofertaDe`: con el módulo `produccion` en desarrollo (hoy), no activo o sin el rol, no; cancelar y anular
 * cierran lo iniciado y pasan con el módulo en solo lectura. Si no se pudieron leer los permisos, ninguna (cierra, no abre). Ocultar no es autorizar: cada acción vuelve a pasar por el guard.
 * Chequeo: `test/web/produccion-acceso.test.ts`.
 */
export async function accionesDeProduccion(
  contexto: ContextoOperativo,
): Promise<AccionesDeLaOrden> {
  const [cancelar, anular] = await Promise.all([
    puedeLaAccion(contexto, "transformaciones.cancelar"),
    puedeLaAccion(contexto, "transformaciones.anular"),
  ]);
  return { cancelar, anular };
}
