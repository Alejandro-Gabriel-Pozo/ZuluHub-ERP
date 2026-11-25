import "server-only";
/**
 * Parte dedicada de `modulos.ts` (archivo central, ver su encabezado): Las ofertas de botones del módulo catálogo: crear, editar y cambiar el precio de productos.
 */
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { ofertaDe, permisosDeLaPersona, puedeLaAccion } from "./permisos-de-la-persona";

/**
 * ¿La persona puede guardar los datos de un producto? Es la oferta de `productos.editar` (gerente y administrador) que el servidor calcula con `ofertaDe`: con el módulo en solo
 * lectura o sin el rol, no. Si no se pudieron leer los permisos, `false` (cierra, no abre). Ocultar no es autorizar: guardar vuelve a pasar por el guard. Es solo la ayuda que apaga
 * «Guardar» (DEC-0346, aprobada por el dueño el 12/11/2026). Chequeo: `test/web/ficha-de-producto-acceso.test.ts`.
 */
export async function puedeEditarProductos(contexto: ContextoOperativo): Promise<boolean> {
  const permisos = await permisosDeLaPersona(contexto);
  return permisos !== null && ofertaDe("productos.editar", permisos).permitida;
}

/**
 * ¿La persona puede crear un producto? Es la oferta de `productos.crear` (gerente y administrador) que el servidor calcula con `ofertaDe`: con el módulo en solo lectura o sin el rol, no.
 * Si no se pudieron leer los permisos, `false` (cierra, no abre). Ocultar no es autorizar: crear vuelve a pasar por el guard. Es solo la ayuda que apaga «Guardar» (DEC-0346, aprobada
 * por el dueño el 12/11/2026). Chequeo: `test/web/alta-de-producto-acceso.test.ts`.
 */
export async function puedeCrearProductos(contexto: ContextoOperativo): Promise<boolean> {
  const permisos = await permisosDeLaPersona(contexto);
  return permisos !== null && ofertaDe("productos.crear", permisos).permitida;
}

/**
 * ¿La persona puede cambiar el precio de un producto? Es la oferta de `productos.cambiar_precio` (gerente y administrador) que el servidor calcula con `ofertaDe`: con el módulo en
 * solo lectura o sin el rol, no. Si no se pudieron leer los permisos, `false` (cierra, no abre). Ocultar no es autorizar: cambiar vuelve a pasar por el guard. Es solo la ayuda que apaga
 * «Guardar» (DEC-0346, aprobada por el dueño el 12/11/2026). Chequeo: `test/web/precios-de-producto-acceso.test.ts`.
 */
export async function puedeCambiarPrecios(contexto: ContextoOperativo): Promise<boolean> {
  const permisos = await permisosDeLaPersona(contexto);
  return permisos !== null && ofertaDe("productos.cambiar_precio", permisos).permitida;
}

export const puedeEditarOpciones = (contexto: ContextoOperativo): Promise<boolean> =>
  puedeLaAccion(contexto, "opciones.editar"); // oferta de `opciones.editar` (gerente y administrador): solo apaga botones, el guard decide (DEC-0346); `test/web/opciones-acceso.test.ts`

/**
 * ¿La persona puede cambiar el tilde «Se controla el stock»? Es la oferta de `articulos.controlar` (gerente y administrador) que el servidor calcula con `ofertaDe`; si no se pudieron leer los
 * permisos, `false` (cierra, no abre). Ocultar no es autorizar: fijar el control vuelve a pasar por el guard. Es solo la ayuda que apaga la casilla. Chequeo: `test/web/control-de-stock-acceso.test.ts`.
 */
export async function puedeControlarElStock(contexto: ContextoOperativo): Promise<boolean> {
  const permisos = await permisosDeLaPersona(contexto);
  return permisos !== null && ofertaDe("articulos.controlar", permisos).permitida;
}

/**
 * ¿La empresa tiene encendida la función «Producción»? Es la perilla `produccion` del plan, leída del mismo cálculo que el guard (`permisosDelActor`); si no se pudieron leer los permisos,
 * `false` (cierra, no abre). Solo decide si la ficha ofrece «Se produce en tanda»: encender el control vuelve a exigir la perilla y la receta en el servidor (`controlarArticulo`). Chequeo:
 * `test/web/ficha-de-producto-acceso.test.ts`.
 */
export async function produccionEncendida(contexto: ContextoOperativo): Promise<boolean> {
  const permisos = await permisosDeLaPersona(contexto);
  return permisos !== null && permisos.funcionesEncendidas.includes("produccion");
}
