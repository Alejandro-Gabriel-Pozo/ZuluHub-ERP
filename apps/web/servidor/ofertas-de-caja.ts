import "server-only";
/**
 * FICHA
 * QUÉ ES: Las ofertas de botones del módulo caja: las listas de medios de pago, cuentas de cobro y cajas.
 * QUÉ NO ES: No lleva la lógica de otro módulo: cada módulo tiene su ofertas-de-MODULO.ts, y las lecturas de permisos pasan por permisos-de-la-persona.ts.
 * QUÉ EXPORTA: accionesDeLaListaDeCaja.
 * QUÉ IMPORTA: permisos-de-la-persona.ts y el modelo de la lista de caja. Lo consumen las páginas, por modulos.ts.
 * Previene: que el archivo común de ofertas vuelva a ser el punto donde chocan todos los PR de pantallas y que una pantalla lea los permisos dos veces por pedido. Chequeo: test/arquitectura/ofertas-por-modulo.test.ts.
 */
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import type { ClaveAccion } from "../../../src/capacidades/modulos/catalogo";
import type { AccionesDeLista } from "../ui/plantillas/caja/lista-de-caja";
import { permisosDeLaPersona } from "./permisos-de-la-persona";

/**
 * Qué botones de una lista de la configuración de caja se ofrecen activos hoy (`medios_de_pago.*`, `cuentas_de_cobro.*` o `cajas.*`, módulo `caja`): los que el SERVIDOR deja
 * hacer según `permisosDelActor` (una lectura por pedido, el mismo cálculo que el guard). Con `caja` en desarrollo o no activo esa lista no trae sus acciones: todo apagado. Sin
 * permisos leídos, todo apagado. Previene: ofrecer un botón que el guard va a rechazar. Es solo una ayuda: cada acción vuelve a pasar por el guard dentro de su transacción.
 */
export async function accionesDeLaListaDeCaja(
  contexto: ContextoOperativo,
  familia: "medios_de_pago" | "cuentas_de_cobro" | "cajas",
): Promise<AccionesDeLista> {
  const permisos = await permisosDeLaPersona(contexto);
  const puede = (accion: ClaveAccion): boolean =>
    permisos !== null && permisos.acciones.includes(accion);
  return {
    agregar: puede(`${familia}.crear`),
    editar: puede(`${familia}.editar`),
    desactivar: puede(`${familia}.desactivar`),
    reactivar: puede(`${familia}.reactivar`),
  };
}
