import type { ContextoOperativo } from "../../../contexto/contexto";
import type { Resultado } from "../../../primitivas/resultado/resultado";
import type { TipoDeOrigenDeFactura } from "../dominio/factura-de-ticket";

/**
 * El puerto que ventas declara para facturar un ticket (E1 §3.4): tipos PROPIOS de ventas, nada importado de fiscal. Quien lo implementa es la
 * composición, el único lugar donde se tocan los dos módulos: traduce estos tipos a los de fiscal y llama a sus cuerpos de transacción con la
 * MISMA `tx` (la `TxDeApp` ya compone los repositorios de los dos sobre la misma conexión), así la factura y el puntero son todo o nada. A
 * ARCA nunca se envía dentro de la transacción: fiscal solo encola el trabajo de validación.
 */

/** El receptor tal como lo manda la pantalla: ventas no lo interpreta, lo pasa a fiscal, que lo valida. */
export type ReceptorDeFactura = Readonly<Record<string, unknown>>;

/** Un renglón de la factura: cantidad y precio como texto decimal exacto (ADR-006). */
export type RenglonDeFactura = Readonly<{
  descripcion: string;
  cantidad: string;
  /** El símbolo que se imprime junto a la cantidad; `null` si no se imprime ninguno. */
  unidad: string | null;
  precioUnitario: string;
  alicuota: string;
}>;

export type EntradaDeFacturaDeTicket = Readonly<{
  origen: Readonly<{ tipo: TipoDeOrigenDeFactura; id: string }>;
  /** El id del comprobante: lo elige ventas y no cambia entre reintentos. */
  comprobanteId: string;
  puntoDeVentaId: string;
  /** La sucursal del ticket, leída de lo guardado (nunca del navegador). */
  sucursalId: string;
  receptor: ReceptorDeFactura;
  renglones: readonly RenglonDeFactura[];
  /** El total que se cobró (texto decimal); el cálculo de fiscal tiene que igualarlo al centavo. */
  totalEsperado: string;
}>;

export type SalidaDeFactura = Readonly<{
  comprobanteId: string;
  estado: string;
  yaExistia: boolean;
}>;

export type VigenciaDeFactura = Readonly<{
  comprobanteId: string;
  vigente: boolean;
  motivoNoVigente: string | null;
}>;

/** Un error de fiscal, ya traducido por la composición: ventas lo devuelve tal cual dentro de `FACTURACION_FALLIDA`. */
export type ErrorDelFacturador = string | Readonly<Record<string, unknown>>;

/**
 * `TxEscritura` es la transacción en la que se emite (la de ventas) y `TxLectura` la de la pregunta de vigencia (la de ventas, o la de lectura de
 * sus consultas): son parámetros para que este archivo no importe los contratos que lo usan (sería un ciclo).
 */
export type FacturadorDeTickets<TxEscritura = never, TxLectura = TxEscritura> = Readonly<{
  emitirEnTx(
    tx: TxEscritura,
    contexto: ContextoOperativo,
    entrada: EntradaDeFacturaDeTicket,
  ): Promise<Resultado<SalidaDeFactura, ErrorDelFacturador>>;
  /** De los comprobantes de la empresa que están en `ids`: ¿cada uno sigue valiendo? Uno que no figura en la respuesta no existe o es de otra empresa. */
  vigenciaEnTx(
    tx: TxLectura,
    contexto: ContextoOperativo,
    ids: readonly string[],
  ): Promise<Resultado<readonly VigenciaDeFactura[], ErrorDelFacturador>>;
}>;
