import "server-only";
/**
 * FICHA
 * QUÉ ES: Las ofertas de botones del módulo catálogo: crear, editar y cambiar el precio de productos.
 * QUÉ NO ES: No lleva la lógica de otro módulo: cada módulo tiene su ofertas-de-MODULO.ts, y las lecturas de permisos pasan por permisos-de-la-persona.ts.
 * QUÉ EXPORTA: puedeEditarProductos, puedeCrearProductos, puedeCambiarPrecios.
 * QUÉ IMPORTA: permisos-de-la-persona.ts. Lo consumen las páginas, por modulos.ts.
 * Previene: que el archivo común de ofertas vuelva a ser el punto donde chocan todos los PR de pantallas y que una pantalla lea los permisos dos veces por pedido. Chequeo: test/arquitectura/ofertas-por-modulo.test.ts.
 */
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { ofertaDe, permisosDeLaPersona } from "./permisos-de-la-persona";

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
