import type { RenglonDeCompra } from "../dominio/registrar-compra";

/** Lo que entra y sale de «Comprar y recibir» (con y sin factura) y la línea ya calculada. Vive aparte para que el caso de uso quepa en un archivo. */

export type EntradaDeRegistrarCompra = Readonly<{
  /** Un UUID que genera la pantalla al abrir: es la idempotencia de la compra (D136). */
  clave: string;
  sucursalId: string;
  proveedorId: string;
  /** El depósito donde entra la mercadería; sin elegir, el único depósito normal activo de la sucursal (S-4). */
  depositoId?: string | null | undefined;
  /** Cuándo llegó la mercadería; por defecto, el `ahora` del contexto. Nunca en el futuro. */
  hechoEn?: Date | undefined;
  remito?: Readonly<{ puntoDeVenta: number; numero: number; fecha: string }> | null | undefined;
  renglones: readonly Readonly<{
    productoId: string;
    presentacionId?: string | null | undefined;
    unidadDeCompraId: string;
    cantidad: string;
    pesoReal?: string | null | undefined;
    precioPor: string;
    unidadDePrecioId?: string | null | undefined;
    precio?: string | null | undefined;
  }>[];
  /**
   * La factura que llega con la mercadería (N2). Solo cuando el nivel de la empresa es `CON_COMPROBANTE`. Las cantidades y precios de sus líneas van en la
   * unidad base del producto (ver `dominio/factura.ts`).
   */
  factura?: unknown;
  /** El pago de la factura, si ya se pagó (D142): `{ fechaDePago, medio }`. Pide `comprobantes_de_proveedor.pagar` y que la compra traiga factura. No mueve la caja. */
  pago?: unknown;
}>;

export type AvisoDeCompra =
  | Readonly<{ tipo: "LETRA_NO_ESPERADA"; esperada: string }>
  | Readonly<{ tipo: "TOTAL_NO_COINCIDE" }>;

export type SalidaDeRegistrarCompra = Readonly<{
  recepcionId: string;
  /** `null` si la compra no trae factura. */
  comprobanteId: string | null;
  /** `null` si la compra no se pagó. */
  pagoId: string | null;
  /** Los movimientos de stock que dejó la compra (uno por depósito); vacío si nada controlaba stock. */
  movimientos: readonly string[];
  /** `true`: la misma compra ya estaba registrada (misma clave y mismo contenido): no se escribió ni se auditó nada. */
  yaExistia: boolean;
  avisos: readonly AvisoDeCompra[];
}>;

/** Una línea ya calculada, lista para guardarse. */
export type LineaCalculada = Readonly<{
  renglon: RenglonDeCompra;
  producto: Readonly<{ id: string; nombre: string; unidadBaseId: string }>;
  dePesoVariable: boolean;
  cantidadEnStock: string;
  importe: string | null;
  costoPorUnidadDeStock: string | null;
}>;
