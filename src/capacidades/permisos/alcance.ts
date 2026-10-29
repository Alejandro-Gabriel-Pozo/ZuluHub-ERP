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

/** Una sucursal de la empresa, abierta (`activa`) o cerrada: lo que hace falta para decidir cuál se elige. */
export type SucursalParaElegir = Readonly<{ id: SucursalId; activa: boolean }>;

/**
 * De las sucursales de la empresa (`todas`, ACTIVAS y cerradas: las lee quien llama), las que el alcance deja elegir para MIRAR
 * (D-37): todas con `"TODAS"`, o las de la lista (que quien llama pide con las cerradas incluidas). Una cerrada se puede
 * elegir para ver su historial; que se pueda operar en ella es otra regla (la de emisión exige sucursal activa).
 * Previene: ofrecer (o aceptar) una sucursal que no es de la persona, o negarle el historial de una cerrada que sí es suya.
 */
export function sucursalesEnAlcance<T extends Readonly<{ id: SucursalId }>>(
  alcance: AlcanceDeSucursales,
  todas: readonly T[],
): readonly T[] {
  if (alcance === "TODAS") return todas;
  return todas.filter((sucursal) => alcance.includes(sucursal.id));
}

/**
 * La ÚNICA sucursal en la que trabaja una pantalla que muestra datos de una sola (el listado de comprobantes, D-18, D-36 y
 * D-37), dadas las que la persona puede elegir (`elegibles`, de `sucursalesEnAlcance`, abiertas y cerradas) y la que dice haber
 * elegido (`elegida`, o `null` si todavía no eligió). Nunca devuelve «todas»:
 *  - eligió una de las elegibles, abierta o cerrada: esa;
 *  - eligió una que no está entre las elegibles (ajena, o no asignada al operador): `SUCURSAL_FUERA_DE_ALCANCE`, aunque
 *    tenga otra sola abierta (no se reemplaza en silencio lo que pidió);
 *  - no eligió y tiene exactamente UNA ABIERTA: esa, sin pedirle nada. Las cerradas no cuentan para esto (SUPUESTO derivado de
 *    D-36: «una sola» se entiende entre las abiertas; las cerradas se eligen a mano);
 *  - no eligió y tiene dos o más abiertas, o ninguna abierta pero alguna cerrada: `SUCURSAL_NO_ELEGIDA` (la pantalla la hace
 *    elegir);
 *  - no tiene ninguna elegible (con o sin elección): `SUCURSAL_FUERA_DE_ALCANCE`, como un operador sin asignaciones.
 * Previene: mostrar los comprobantes de todas las sucursales cuando falta la elección, o los de una que no es de la persona.
 */
export function resolverSucursal(
  elegida: SucursalId | null,
  elegibles: readonly SucursalParaElegir[],
): Resultado<SucursalId, ErrorDeSucursalElegida> {
  if (elegida !== null) {
    const dentro = exigirSucursal(
      elegibles.map((sucursal) => sucursal.id),
      elegida,
    );
    return dentro.ok ? ok(elegida) : dentro;
  }
  if (elegibles.length === 0) return err("SUCURSAL_FUERA_DE_ALCANCE");
  const abiertas = elegibles.filter((sucursal) => sucursal.activa);
  const [unica, otra] = abiertas;
  // Exactamente una abierta: hay la primera y no hay una segunda.
  return unica === undefined || otra !== undefined ? err("SUCURSAL_NO_ELEGIDA") : ok(unica.id);
}
