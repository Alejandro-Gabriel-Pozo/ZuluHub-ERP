import "server-only";
/**
 * Parte dedicada de `modulos.ts` (archivo central, ver su encabezado): Las ofertas de botones de las pantallas de Stock (Depósitos, Existencias, Movimientos y Conteo).
 */
import type { ClaveAccion } from "../../../src/capacidades/modulos/catalogo";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { permisosDeLaPersona, puedeLaAccion } from "./permisos-de-la-persona";

/**
 * ¿Se ofrece este botón de Stock hoy? Es la oferta de esa acción (`ofertaDe`): con el módulo `stock` en desarrollo, no activo o en solo lectura, o sin el rol, no. Si no se pudieron leer los
 * permisos, `false` (cierra, no abre). Es solo una ayuda: apagar un botón no es autorizar, cada acción vuelve a pasar por el guard. Chequeo: `test/web/ofertas-de-stock.test.ts`.
 */
export const puedeEnStock = (contexto: ContextoOperativo, accion: ClaveAccion): Promise<boolean> =>
  puedeLaAccion(contexto, accion);

/**
 * ¿La persona puede guardar recetas (crear una, agregar o quitar ingredientes, nueva versión)? Es la oferta de `composiciones.editar` (gerente y administrador): con el módulo en solo lectura o sin el
 * rol, no. Si no se pudieron leer los permisos, `false` (cierra, no abre). Ocultar no es autorizar: guardar vuelve a pasar por el guard, con alcance de todas las sucursales. Es solo la ayuda que apaga
 * «Nueva receta», «Editar», «Agregar ingrediente», «Quitar» y «Guardar» (B8, `recetas-pantalla.md` §3). Chequeo: `test/web/recetas-acceso.test.ts`.
 */
export const puedeEditarRecetas = (contexto: ContextoOperativo): Promise<boolean> =>
  puedeEnStock(contexto, "composiciones.editar");

/**
 * ¿El plan tiene la perilla `lotes`? Solo decide si «Controlar por lote» se ofrece (con la perilla apagada no hay botón, no un error: FP-STK-13); controlar vuelve a exigirla en el servidor. Sin permisos legibles,
 * `false` (cierra, no abre). Chequeo: `test/web/ofertas-de-stock.test.ts`.
 */
export async function lotesEncendidos(contexto: ContextoOperativo): Promise<boolean> {
  const permisos = await permisosDeLaPersona(contexto);
  return permisos !== null && permisos.funcionesEncendidas.includes("lotes");
}
