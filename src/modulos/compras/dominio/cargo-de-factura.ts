import { uuidV5DeLista } from "../../../primitivas/identificadores/uuid-determinista";

/**
 * El cargo de una factura de proveedor en el libro de saldos (L1): cada factura registrada deja UN asiento «cargo» (lo que se le debe al proveedor) y, al anularla, su espejo. Puro: sin reloj ni azar.
 * La clave y el origen salen del comprobante (no del azar): un reintento repite la misma clave y el libro devuelve lo hecho.
 */
export const ORIGEN_DEL_CARGO_DE_FACTURA = "compras.factura";
export const CLASE_DEL_CARGO_DE_FACTURA = "CARGO_DE_FACTURA_DE_COMPRA";
/** El texto del espejo: un código, no un texto que vea el cliente (el motivo de la anulación queda en el comprobante). */
export const DETALLE_DE_LA_ANULACION_DEL_CARGO = "ANULACION-DE-FACTURA";

// Los espacios de nombres son fijos: cambiar uno reescribiría la identidad de lo ya asentado.
const ESPACIO_DEL_CARGO = "5e0b7c1a-8d2f-4f63-9a41-3c7d2b6e9f10";
const ESPACIO_DE_LA_ANULACION_DEL_CARGO = "b4a96d02-17c8-4e55-8f3a-d1e0c9b72a64";

export const claveDelCargo = (comprobanteId: string): string =>
  uuidV5DeLista(ESPACIO_DEL_CARGO, [comprobanteId]);

export const claveDeLaAnulacionDelCargo = (comprobanteId: string): string =>
  uuidV5DeLista(ESPACIO_DE_LA_ANULACION_DEL_CARGO, [comprobanteId]);

/**
 * El pago de una factura en el libro (L2): cada pago deja UN asiento de pago (lo que se le pagó al proveedor, resta) imputado contra el cargo de su factura; al anular el pago, el espejo (que deshace la imputación).
 * Las claves salen del pago: reintentar el mismo pago repite las mismas y el libro devuelve lo hecho.
 */
export const ORIGEN_DEL_PAGO = "compras.pago";
export const CLASE_DEL_PAGO = "PAGO_A_PROVEEDOR";
/** El texto del espejo del pago: un código, no un texto que vea el cliente (el motivo de la anulación queda en el pago). */
export const DETALLE_DE_LA_ANULACION_DEL_PAGO = "ANULACION-DE-PAGO";

const ESPACIO_DEL_PAGO = "7c3e1d90-2b4a-4a8e-b6f1-0e5d8a9c4b21";
const ESPACIO_DE_LA_IMPUTACION_DEL_PAGO = "a1d84f37-6c0e-4b92-9d5a-2f7b3e8c1d60";
const ESPACIO_DE_LA_ANULACION_DEL_PAGO = "e92b5a14-3d7c-4f08-a6b1-8c4d0f2e7a35";

export const claveDelPago = (pagoId: string): string => uuidV5DeLista(ESPACIO_DEL_PAGO, [pagoId]);

export const claveDeLaImputacionDelPago = (pagoId: string): string =>
  uuidV5DeLista(ESPACIO_DE_LA_IMPUTACION_DEL_PAGO, [pagoId]);

export const claveDeLaAnulacionDelPago = (pagoId: string): string =>
  uuidV5DeLista(ESPACIO_DE_LA_ANULACION_DEL_PAGO, [pagoId]);

/**
 * Las notas del proveedor en el libro (L3a): una nota de crédito deja un asiento de nota (resta) imputado contra el cargo de su factura y una nota de débito, un cargo suelto del proveedor (suma, se paga aparte); al anularlas, el
 * espejo. Las claves salen de la nota: reintentar la misma repite las mismas y el libro devuelve lo hecho.
 */
export const ORIGEN_DE_LA_NOTA = "compras.nota";
export const CLASE_DE_LA_NOTA_DE_CREDITO = "NOTA_DE_CREDITO_DE_COMPRA";
export const CLASE_DE_LA_NOTA_DE_DEBITO = "NOTA_DE_DEBITO_DE_COMPRA";
/** El texto del espejo de una nota: un código, no un texto que vea el cliente (el motivo de la anulación queda en la nota). */
export const DETALLE_DE_LA_ANULACION_DE_LA_NOTA = "ANULACION-DE-NOTA";

const ESPACIO_DE_LA_NOTA = "2f8d6b41-9a3c-4e17-b5d0-7c1e4a93f6b8";
const ESPACIO_DE_LA_IMPUTACION_DE_LA_NOTA = "c47a1e95-0b6d-4d32-8f2a-5e9b3d7c1a04";
const ESPACIO_DE_LA_ANULACION_DE_LA_NOTA = "91e3b7d2-5f08-4a6c-a1d4-3b8c0e6f2d57";

export const claveDeLaNota = (notaId: string): string =>
  uuidV5DeLista(ESPACIO_DE_LA_NOTA, [notaId]);

export const claveDeLaImputacionDeLaNota = (notaId: string): string =>
  uuidV5DeLista(ESPACIO_DE_LA_IMPUTACION_DE_LA_NOTA, [notaId]);

export const claveDeLaAnulacionDeLaNota = (notaId: string): string =>
  uuidV5DeLista(ESPACIO_DE_LA_ANULACION_DE_LA_NOTA, [notaId]);

/** Cómo se reparte el cargo entre sucursales (centro de costo); `null` es «sin centro de costo». Los importes son texto decimal en pesos y suman el total. */
export type RepartoDelCargo = Readonly<{ sucursalId: string | null; importe: string }>;

/**
 * El reparto por defecto: todo a la sucursal de la recepción con la que se carga la factura (N1 y N2) o, si la factura es de la empresa y no tiene sucursal (N3 y N4),
 * a «sin centro de costo». Quien reparte la factura entre sucursales (servicios) pasa el suyo.
 */
export const repartoPorDefecto = (
  sucursalId: string | null,
  total: string,
): readonly RepartoDelCargo[] => [{ sucursalId, importe: total }];
