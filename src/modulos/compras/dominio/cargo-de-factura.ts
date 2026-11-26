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
