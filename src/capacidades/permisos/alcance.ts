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
