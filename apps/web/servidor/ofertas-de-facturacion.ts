import "server-only";
/**
 * FICHA
 * QUÉ ES: Las ofertas de botones del módulo facturación: notas de crédito y facturas.
 * QUÉ NO ES: No lleva la lógica de otro módulo: cada módulo tiene su ofertas-de-MODULO.ts, y las lecturas de permisos pasan por permisos-de-la-persona.ts.
 * QUÉ EXPORTA: puedeEmitirNotasDeCredito, puedeEmitirFacturas.
 * QUÉ IMPORTA: permisos-de-la-persona.ts. Lo consumen las páginas, por modulos.ts.
 * Previene: que el archivo común de ofertas vuelva a ser el punto donde chocan todos los PR de pantallas y que una pantalla lea los permisos dos veces por pedido. Chequeo: test/arquitectura/ofertas-por-modulo.test.ts.
 */
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { permisosDeLaPersona } from "./permisos-de-la-persona";

/**
 * ¿La persona puede emitir notas de crédito hoy? Depende SOLO de que `permisosDelActor().acciones` incluya `notas_de_credito.emitir`:
 * esa lista sale del mismo cálculo que el guard, y esa acción es `COMPLETA_CIERRA` (`src/capacidades/modulos/catalogo.ts`), que el
 * guard deja pasar también con el módulo en solo lectura. Por eso el botón y la pantalla de anular SÍ se ofrecen en solo lectura
 * (corrección del dueño, 2026-10-29, cuestionario en la sesión web del carril web). Si `permisosDelActor` falla, no se ofrece
 * (cierra, no abre). Ocultar no es autorizar: la acción vuelve a pasar por el guard, dentro de su transacción.
 */
export async function puedeEmitirNotasDeCredito(contexto: ContextoOperativo): Promise<boolean> {
  const permisos = await permisosDeLaPersona(contexto);
  return permisos !== null && permisos.acciones.includes("notas_de_credito.emitir");
}

/**
 * ¿La persona puede emitir una factura hoy? Depende SOLO de que `permisosDelActor().acciones` incluya `comprobantes.emitir_manual`, la
 * acción que el guard de emitir exige (`DECLARACIONES_DE_FACTURACION.emitirComprobanteManual`) y la de las dos lecturas de Emitir.
 * Esa lista sale del mismo cálculo que el guard (`accionesPermitidas`), así que sigue su regla sin repetirla: esa acción es
 * `CREA_AMPLIA` (`catalogo.ts`), que el guard rechaza con el módulo en solo lectura, y entonces el botón NO se ofrece ahí (a
 * diferencia de anular, que sí). Si `permisosDelActor` falla, no se ofrece (cierra, no abre). Ocultar no es autorizar: la acción vuelve a
 * pasar por el guard, dentro de su transacción. Chequeo: `test/web/modulos-de-la-barra.test.ts`.
 */
export async function puedeEmitirFacturas(contexto: ContextoOperativo): Promise<boolean> {
  const permisos = await permisosDeLaPersona(contexto);
  return permisos !== null && permisos.acciones.includes("comprobantes.emitir_manual");
}
