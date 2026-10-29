import {
  resolverSucursal,
  sucursalesEnAlcance,
  type ErrorDeSucursalElegida,
} from "../../../capacidades/permisos/alcance";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { SucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { TxDeConsultasDeFacturacion } from "./contrato";

/**
 * La sucursal que una pantalla del facturador usó, tal como la muestra: su id, su nombre y si está abierta (`activa: false`: cerrada,
 * D-37; el texto «cerrada» lo pone la pantalla). Es lo que ya trae la lectura de las sucursales de la empresa: no cuesta otra consulta.
 */
export type SucursalDelPedido = Readonly<{ id: SucursalId; nombre: string; activa: boolean }>;

/**
 * La sucursal en la que trabaja una pantalla del facturador que muestra datos de UNA sola (D-18), resuelta por el SERVIDOR
 * dentro de la transacción de la consulta: de las sucursales de la empresa (abiertas y cerradas, D-37), las que el alcance del
 * actor deja elegir, y de ahí `resolverSucursal` (elegida, la única abierta que tiene, o error). `elegida` es lo que la persona dice haber elegido (o
 * `null`): nunca se confía en ella sin verificarla acá. Las dos consultas que la usan (el listado y la lista de puntos de
 * venta) comparten esta regla para que no puedan resolverla distinto.
 */
export async function sucursalDelPedido(
  tx: Pick<TxDeConsultasDeFacturacion, "autorizacion" | "sucursales">,
  contexto: ContextoOperativo,
  elegida: SucursalId | null,
): Promise<Resultado<SucursalDelPedido, ErrorDeSucursalElegida>> {
  // Se miran también las cerradas (D-37): se pueden elegir para ver su historial.
  const alcance = await tx.autorizacion.sucursalesDelActor(contexto, { incluirDesactivadas: true });
  const todas = await tx.sucursales.listar(contexto.empresaId);
  const elegibles = sucursalesEnAlcance(alcance, todas);
  const resuelta = resolverSucursal(elegida, elegibles);
  if (!resuelta.ok) return resuelta;
  const sucursal = elegibles.find((s) => s.id === resuelta.valor);
  // Siempre está (`resolverSucursal` devuelve una de las elegibles); si no, falla cerrado: ninguna sucursal.
  if (sucursal === undefined) return err("SUCURSAL_FUERA_DE_ALCANCE");
  return ok({ id: sucursal.id, nombre: sucursal.nombre, activa: sucursal.activa });
}
