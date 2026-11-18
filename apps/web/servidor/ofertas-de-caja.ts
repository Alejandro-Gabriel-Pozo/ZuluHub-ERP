import "server-only";
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
