import { resolverSucursal, sucursalesEnAlcance } from "../../../capacidades/permisos/alcance";
import type { ErrorDeSucursalElegida } from "../../../capacidades/permisos/alcance";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { SucursalId } from "../../../primitivas/identificadores/marca";
import type { Resultado } from "../../../primitivas/resultado/resultado";
import type { TxDeConsultasDeFacturacion } from "./contrato";

/**
 * La sucursal en la que trabaja una pantalla del facturador que muestra datos de UNA sola (D-18), resuelta por el SERVIDOR
 * dentro de la transacción de la consulta: de las sucursales activas de la empresa, las que el alcance del actor deja elegir,
 * y de ahí `resolverSucursal` (elegida, la única que tiene, o error). `elegida` es lo que la persona dice haber elegido (o
 * `null`): nunca se confía en ella sin verificarla acá. Las dos consultas que la usan (el listado y la lista de puntos de
 * venta) comparten esta regla para que no puedan resolverla distinto.
 */
export async function sucursalDelPedido(
  tx: Pick<TxDeConsultasDeFacturacion, "autorizacion" | "sucursales">,
  contexto: ContextoOperativo,
  elegida: SucursalId | null,
): Promise<Resultado<SucursalId, ErrorDeSucursalElegida>> {
  const alcance = await tx.autorizacion.sucursalesDelActor(contexto);
  const activas = await tx.sucursales.listarActivas(contexto.empresaId);
  return resolverSucursal(
    elegida,
    sucursalesEnAlcance(alcance, activas).map((sucursal) => sucursal.id),
  );
}
