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
 *
 * ORDEN DE BLOQUEO (el único lugar donde está escrito): el COMPROBANTE de la FACTURA, después la NOTA (su comprobante), el PAGO y por último la PARTE del libro. Lo cumplen registrar y anular la factura, declarar y anular el pago (que
 * antes bloqueaba el pago primero: cruzado con anular la factura era un abrazo mortal posible) y registrar y anular una nota de crédito (la base bloquea la factura al insertar la nota; anular la nota bloquea primero la factura).
 * Chequeo: `compras-pago-en-el-libro.test.ts` y `compras-nota-en-el-libro.test.ts` (dos actores, todas las combinaciones).
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

/**
 * El pago de la factura en el libro (L2): el asiento de pago imputado contra el cargo, por el `importe` que se guardó en el pago. Lo llaman TODOS los casos de uso que guardan un pago (`declararPago` y la compra N2 con pago)
 * AL FINAL de su transacción, con el comprobante ya bloqueado y ANTES de que el libro tome la parte (mismo orden de bloqueo que el cargo). Un error del libro deshace TODO: el pago, sus líneas, el egreso de caja y la auditoría.
 */
export async function asentarElPagoDeLaFactura(
  tx: TxDeCompras,
  contexto: ContextoOperativo,
  dependencias: DependenciasDeCompras,
  datos: Readonly<{ pagoId: string; comprobanteId: string; importe: string }>,
): Promise<R<null>> {
  const asiento = await dependencias.libroDeProveedores.registrarPago(tx, contexto, {
    ...datos,
    hechoEn: contexto.ahora,
  });
  return asiento.ok ? ok(null) : err(asiento.error);
}

/** El espejo del pago al anularlo: sin asiento (un pago anterior al libro) falla cerrado, igual que el cargo. */
export async function anularElPagoDeLaFactura(
  tx: TxDeCompras,
  contexto: ContextoOperativo,
  dependencias: DependenciasDeCompras,
  pagoId: string,
): Promise<R<null>> {
  const espejo = await dependencias.libroDeProveedores.anularPago(tx, contexto, { pagoId });
  return espejo.ok ? ok(null) : err(espejo.error);
}

/**
 * La nota de crédito en el libro (L3a): el asiento de nota imputado contra el cargo de su factura (lo que sobre de lo pendiente queda como saldo a favor de la empresa). Lo llama el caso de uso que guarda la nota AL FINAL de su
 * transacción, con la factura ya bloqueada por la base. Un error del libro deshace TODO: la nota no queda sin su asiento.
 */
export async function asentarLaNotaDeCredito(
  tx: TxDeCompras,
  contexto: ContextoOperativo,
  dependencias: DependenciasDeCompras,
  datos: Readonly<{ notaId: string; facturaId: string; importe: string }>,
): Promise<R<null>> {
  const asiento = await dependencias.libroDeProveedores.registrarNotaDeCredito(tx, contexto, {
    ...datos,
    hechoEn: contexto.ahora,
  });
  return asiento.ok ? ok(null) : err(asiento.error);
}

/** El espejo de la nota de crédito al anularla: sin asiento (una nota anterior al libro) falla cerrado, igual que el cargo y el pago. */
export async function anularLaNotaDeCredito(
  tx: TxDeCompras,
  contexto: ContextoOperativo,
  dependencias: DependenciasDeCompras,
  notaId: string,
): Promise<R<null>> {
  const espejo = await dependencias.libroDeProveedores.anularNotaDeCredito(tx, contexto, {
    notaId,
  });
  return espejo.ok ? ok(null) : err(espejo.error);
}

/**
 * La nota de débito en el libro (L3a): un cargo suelto del proveedor, con la distribución de la factura vinculada si hay (la nota sola no cambia lo pendiente de la factura: se paga aparte). Lo llama el caso de uso que guarda la nota
 * AL FINAL de su transacción; un error del libro deshace TODO.
 */
export async function asentarLaNotaDeDebito(
  tx: TxDeCompras,
  contexto: ContextoOperativo,
  dependencias: DependenciasDeCompras,
  datos: Readonly<{
    notaId: string;
    proveedorId: string;
    facturaId: string | null;
    importe: string;
  }>,
): Promise<R<null>> {
  const asiento = await dependencias.libroDeProveedores.registrarNotaDeDebito(tx, contexto, {
    ...datos,
    hechoEn: contexto.ahora,
  });
  return asiento.ok ? ok(null) : err(asiento.error);
}

/** El espejo de la nota de débito al anularla: sin asiento (una nota anterior al libro) falla cerrado, igual que la de crédito. */
export async function anularLaNotaDeDebito(
  tx: TxDeCompras,
  contexto: ContextoOperativo,
  dependencias: DependenciasDeCompras,
  notaId: string,
): Promise<R<null>> {
  const espejo = await dependencias.libroDeProveedores.anularNotaDeDebito(tx, contexto, { notaId });
  return espejo.ok ? ok(null) : err(espejo.error);
}
