import "server-only";
/**
 * FICHA
 * QUÉ ES: Las ofertas de botones del módulo salón: mesas, cambio de mesa, unir y dividir cuentas.
 * QUÉ NO ES: No lleva la lógica de otro módulo: cada módulo tiene su ofertas-de-MODULO.ts, y las lecturas de permisos pasan por permisos-de-la-persona.ts.
 * QUÉ EXPORTA: puedeAdministrarMesas, puedeCambiarDeMesa, puedeUnirMesas, puedeDividirCuentas.
 * QUÉ IMPORTA: permisos-de-la-persona.ts. Lo consumen las páginas, por modulos.ts.
 * Previene: que el archivo común de ofertas vuelva a ser el punto donde chocan todos los PR de pantallas y que una pantalla lea los permisos dos veces por pedido. Chequeo: test/arquitectura/ofertas-por-modulo.test.ts.
 */
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { ofertaDe, permisosDeLaPersona, puedeLaAccion } from "./permisos-de-la-persona";

/**
 * ¿La persona puede administrar las mesas del salón? Es la oferta de `mesas.editar` (Gerente y Administrador, decisión del dueño) que el servidor calcula con `ofertaDe`: con el módulo
 * en desarrollo, en solo lectura o sin el rol, no. Si no se pudieron leer los permisos, `false` (cierra, no abre). Ocultar no es autorizar: guardar vuelve a pasar por el guard.
 * Chequeo: `test/web/mesas-acceso.test.ts`.
 */
export async function puedeAdministrarMesas(contexto: ContextoOperativo): Promise<boolean> {
  const permisos = await permisosDeLaPersona(contexto);
  return permisos !== null && ofertaDe("mesas.editar", permisos).permitida;
}

/**
 * Los botones del salón (S-0r), uno por grupo de acciones: ¿la persona puede cambiar de mesa, unir o dividir? Cada una es la oferta de SU
 * acción (`salon.cambiar_mesa`, `salon.unir`, `salon.dividir`: los tres roles) que el servidor calcula con `ofertaDe`: con el módulo en
 * desarrollo, en solo lectura o sin el rol, no. Si no se pudieron leer los permisos, `false` (cierra, no abre). Ocultar no es autorizar:
 * la acción vuelve a pasar por el guard. Es solo la ayuda que apaga el botón. Chequeo: `test/web/salon-acceso.test.ts`.
 */
export const puedeCambiarDeMesa = (contexto: ContextoOperativo): Promise<boolean> =>
  puedeLaAccion(contexto, "salon.cambiar_mesa");
export const puedeUnirMesas = (contexto: ContextoOperativo): Promise<boolean> =>
  puedeLaAccion(contexto, "salon.unir");
export const puedeDividirCuentas = (contexto: ContextoOperativo): Promise<boolean> =>
  puedeLaAccion(contexto, "salon.dividir");
