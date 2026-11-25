import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { repartoPorDefecto, type RepartoDelCargo } from "../dominio/cargo-de-factura";
import type { DependenciasDeCompras, TxDeCompras } from "./contrato";
import type { ErrorDeCompras } from "./errores";

type R<S> = Resultado<S, ErrorDeCompras>;

/**
 * El cargo de la factura en el libro de saldos (L1). Lo llama TODO caso de uso que guarda una factura de proveedor (compras N2 y N3 hoy; servicios y activos fijos después, con su propio `reparto`
 * entre sucursales) y lo hace AL FINAL de su transacción. ORDEN DE BLOQUEO: primero el comprobante (el caso de uso ya lo insertó o lo bloqueó) y DESPUÉS la parte (el libro toma el saldo del proveedor
 * al asentar): quien paga, anula un pago o anula la factura bloquea en el mismo orden, así que dos operaciones a la vez sobre la misma factura y proveedor se turnan sin abrazo mortal.
 * Un error del libro deshace TODA la transacción (la factura no queda sin su cargo).
 */
export async function asentarElCargoDeLaFactura(
  tx: TxDeCompras,
  contexto: ContextoOperativo,
  dependencias: DependenciasDeCompras,
  datos: Readonly<{
    comprobanteId: string;
    proveedorId: string;
    /** Texto decimal en pesos: el total que dice la factura. */
    total: string;
    venceEl: string | null;
    /** La sucursal de la recepción con la que se carga (N1 y N2); `null` si la factura es de la empresa (N3 y N4). Se ignora si viene `reparto`. */
    sucursalId: string | null;
    /** El reparto entre sucursales de quien lo decide (servicios); sin él, todo a `sucursalId`. */
    reparto?: readonly RepartoDelCargo[];
  }>,
): Promise<R<null>> {
  const asiento = await dependencias.libroDeProveedores.registrarCargo(tx, contexto, {
    comprobanteId: datos.comprobanteId,
    proveedorId: datos.proveedorId,
    total: datos.total,
    venceEl: datos.venceEl,
    reparto: datos.reparto ?? repartoPorDefecto(datos.sucursalId, datos.total),
    hechoEn: contexto.ahora,
  });
  return asiento.ok ? ok(null) : err(asiento.error);
}

/** El espejo del cargo al anular la factura, al final de la transacción y en el mismo orden de bloqueo. Sin asiento (una factura que no lo tiene) falla cerrado: es un defecto, no algo para tragar. */
export async function anularElCargoDeLaFactura(
  tx: TxDeCompras,
  contexto: ContextoOperativo,
  dependencias: DependenciasDeCompras,
  comprobanteId: string,
): Promise<R<null>> {
  const espejo = await dependencias.libroDeProveedores.anularCargo(tx, contexto, { comprobanteId });
  return espejo.ok ? ok(null) : err(espejo.error);
}
