import type { SucursalId } from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";

/**
 * Alcance de sucursales del operador (H6: la asignación limita al operador; conciliación §3.4). Es
 * INTEGRIDAD, no un control (ADR-008): lo decide el servidor con datos leídos en la misma
 * transacción, nunca la pantalla. `"TODAS"`: gerente y administrador operan en cualquier sucursal.
 * Una lista: las sucursales donde la persona tiene asignación activa y la sucursal está activa (puede
 * ser vacía: un operador sin asignaciones no opera en ninguna).
 */
export type AlcanceDeSucursales = "TODAS" | readonly SucursalId[];

/** Único error de alcance para todos los módulos operativos (caja, catálogo, stock, reservas, ventas). */
export type ErrorDeAlcance = "SUCURSAL_FUERA_DE_ALCANCE";

/**
 * Puro y síncrono, como el guard. Previene que cada módulo operativo repita su propia versión de «el
 * operador solo trabaja en sus sucursales» con otro nombre de error; si se quita, una operación sobre
 * una sucursal ajena pasa sin que nadie la frene.
 */
export function exigirSucursal(
  alcance: AlcanceDeSucursales,
  sucursal: SucursalId,
): Resultado<null, ErrorDeAlcance> {
  if (alcance === "TODAS") return ok(null);
  return alcance.includes(sucursal) ? ok(null) : err("SUCURSAL_FUERA_DE_ALCANCE");
}

/** Los errores de quedarse con UNA sucursal: la pedida no es del alcance, o hay varias y la persona no eligió. */
export type ErrorDeSucursalElegida = ErrorDeAlcance | "SUCURSAL_NO_ELEGIDA";

/**
 * De las sucursales ACTIVAS de la empresa (`activas`, que las lee quien llama), las que el alcance deja elegir: todas con
 * `"TODAS"`, o las de la lista. Una sucursal desactivada nunca se elige, aunque la persona siga asignada a ella.
 * Previene: ofrecer (o aceptar) una sucursal que ya no existe para operar.
 */
export function sucursalesEnAlcance<T extends Readonly<{ id: SucursalId }>>(
  alcance: AlcanceDeSucursales,
  activas: readonly T[],
): readonly T[] {
  if (alcance === "TODAS") return activas;
  return activas.filter((sucursal) => alcance.includes(sucursal.id));
}

/**
 * La ÚNICA sucursal en la que trabaja una pantalla que muestra datos de una sola (el listado de comprobantes, D-18), dadas
 * las que la persona puede elegir (`elegibles`, de `sucursalesEnAlcance`) y la que dice haber elegido (`elegida`, o `null`
 * si todavía no eligió). Nunca devuelve «todas»:
 *  - elegió una que está entre las elegibles: esa;
 *  - elegió una que no está (ya no es de su alcance, se desactivó o no es de su empresa): `SUCURSAL_FUERA_DE_ALCANCE`,
 *    aunque tenga otra sola elegible (no se reemplaza en silencio lo que pidió);
 *  - no eligió y tiene exactamente una elegible: esa, sin pedirle nada;
 *  - no eligió y tiene varias: `SUCURSAL_NO_ELEGIDA` (la pantalla la hace elegir);
 *  - no tiene ninguna elegible (con o sin elección): `SUCURSAL_FUERA_DE_ALCANCE`, como un operador sin asignaciones.
 * Previene: mostrar los comprobantes de todas las sucursales cuando falta la elección, o los de una que no es de la persona.
 */
export function resolverSucursal(
  elegida: SucursalId | null,
  elegibles: readonly SucursalId[],
): Resultado<SucursalId, ErrorDeSucursalElegida> {
  if (elegida !== null) {
    const dentro = exigirSucursal(elegibles, elegida);
    return dentro.ok ? ok(elegida) : dentro;
  }
  const [unica, ...resto] = elegibles;
  if (unica === undefined) return err("SUCURSAL_FUERA_DE_ALCANCE");
  return resto.length === 0 ? ok(unica) : err("SUCURSAL_NO_ELEGIDA");
}
