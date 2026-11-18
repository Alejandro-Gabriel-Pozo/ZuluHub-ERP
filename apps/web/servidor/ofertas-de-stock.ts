import "server-only";
/**
 * Parte dedicada de `modulos.ts` (archivo central, ver su encabezado): Las ofertas de botones de las pantallas de Stock (Depósitos, Existencias, Movimientos y Conteo).
 */
import type { ClaveAccion } from "../../../src/capacidades/modulos/catalogo";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { puedeLaAccion } from "./permisos-de-la-persona";

/**
 * ¿Se ofrece este botón de Stock hoy? Es la oferta de esa acción (`ofertaDe`): con el módulo `stock` en desarrollo, no activo o en solo lectura, o sin el rol, no. Si no se pudieron leer los
 * permisos, `false` (cierra, no abre). Es solo una ayuda: apagar un botón no es autorizar, cada acción vuelve a pasar por el guard. Chequeo: `test/web/ofertas-de-stock.test.ts`.
 */
export const puedeEnStock = (contexto: ContextoOperativo, accion: ClaveAccion): Promise<boolean> =>
  puedeLaAccion(contexto, accion);
