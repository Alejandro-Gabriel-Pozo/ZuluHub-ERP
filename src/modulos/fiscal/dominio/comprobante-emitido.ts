import type { Importe, ImporteJson } from "../../../primitivas/dinero/importe";
import type { Domicilio } from "../../../primitivas/domicilio/domicilio";
import type { Cuit } from "../../../primitivas/identificacion-fiscal/cuit";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import type { CondicionIva } from "./emisor";
import type { EmisorId, OrigenId, PuntoDeVentaId } from "./identificadores";

/**
 * Contrato del comprobante (spec H7 §B.7): SOLO tipos y funciones puras sobre ellos. No hay tabla
 * `comprobante` ni emisión real en H7; esto fija la forma para que la facturación no tenga que
 * cambiar la numeración ni los emisores.
 *
 * Lo que el comprobante guarda y nunca más cambia: el emisor, el punto de venta y una INSTANTÁNEA
 * del emisor (CUIT y razón social tal como estaban). Cambiar la configuración después no altera lo
 * emitido (decisión 21 del dueño, nivel 4).
 */

/**
 * NO VERIFICADO: los códigos de ARCA de cada tipo no están acá; se siembran desde ARCA junto con la
 * emisión. La lista es la del diseño (Factura, Nota de débito y Nota de crédito, letras A, B y C).
 */
export const TIPOS_DE_COMPROBANTE = [
  "FACTURA_A",
  "FACTURA_B",
  "FACTURA_C",
  "NOTA_DEBITO_A",
  "NOTA_DEBITO_B",
  "NOTA_DEBITO_C",
  "NOTA_CREDITO_A",
  "NOTA_CREDITO_B",
  "NOTA_CREDITO_C",
] as const;

export type TipoDeComprobante = (typeof TIPOS_DE_COMPROBANTE)[number];

export type ClaseDeComprobante = "FACTURA" | "NOTA_DEBITO" | "NOTA_CREDITO";

export type LetraDeComprobante = "A" | "B" | "C";

export function esTipoDeComprobante(texto: string): texto is TipoDeComprobante {
  return (TIPOS_DE_COMPROBANTE as readonly string[]).includes(texto);
}

/** La clase del tipo: `NOTA_CREDITO_B` es una `NOTA_CREDITO`. */
export function claseDeComprobante(tipo: TipoDeComprobante): ClaseDeComprobante {
  if (tipo.startsWith("NOTA_CREDITO")) return "NOTA_CREDITO";
  return tipo.startsWith("NOTA_DEBITO") ? "NOTA_DEBITO" : "FACTURA";
}

export function letraDeComprobante(tipo: TipoDeComprobante): LetraDeComprobante {
  return tipo.endsWith("_A") ? "A" : tipo.endsWith("_B") ? "B" : "C";
}

export type EstadoDeComprobante = "PENDIENTE" | "AUTORIZADO" | "RECHAZADO" | "INCIERTO";

/**
 * Catálogo cerrado de tipos de origen (spec H7 §B, ADR-014). Fiscal NO los interpreta: son nombres
 * opacos que sirven para distinguir de dónde nace un comprobante y para la clave de idempotencia.
 * Quien factura pone el tipo y el identificador; un módulo nuevo que factura suma un tipo acá, sin
 * cambiar ninguna lógica. El facturador solo usa `MANUAL` (id = la clave de idempotencia que manda el
 * cliente); `SUSCRIPCION` es la facturación del SaaS, futura.
 */
export const TIPOS_DE_ORIGEN = [
  "MANUAL",
  "EJEMPLAR_DE_TICKET",
  "PROPINA_DE_TICKET",
  "CORRECCION_DE_TICKET",
  "SUSCRIPCION",
] as const;

export type TipoDeOrigen = (typeof TIPOS_DE_ORIGEN)[number];

export function esTipoDeOrigen(texto: string): texto is TipoDeOrigen {
  return (TIPOS_DE_ORIGEN as readonly string[]).includes(texto);
}

/** De dónde nace el comprobante: un tipo del catálogo y el identificador que da quien factura. */
export type OrigenDeComprobante = Readonly<{ tipo: TipoDeOrigen; id: OrigenId }>;

/**
 * Los datos del emisor tal como estaban al emitir: el CUIT, la razón social, la condición frente al
 * IVA, el domicilio fiscal, el número del punto de venta y su domicilio. Se guardan completos en el
 * comprobante; no se leen de la configuración vigente.
 */
export type InstantaneaDeEmisor = Readonly<{
  cuit: Cuit;
  razonSocial: string;
  condicionIva: CondicionIva;
  domicilioFiscal: Domicilio;
  puntoDeVentaNumero: number;
  domicilioDelPuntoDeVenta: Domicilio;
}>;

/**
 * Clave de idempotencia futura del comprobante `(empresa, origen_tipo, origen_id, emisor, clase)`:
 * un origen genera a lo sumo un comprobante de cada clase por emisor. Repetir el pedido devuelve el
 * mismo. El tipo forma parte de la clave: el mismo id con otro tipo de origen es otro origen.
 */
export type ClaveDeIdempotenciaDeComprobante = Readonly<{
  empresaId: EmpresaId;
  origenTipo: TipoDeOrigen;
  origenId: OrigenId;
  emisorId: EmisorId;
  clase: ClaseDeComprobante;
}>;

export function claveDeIdempotenciaDeComprobante(
  empresaId: EmpresaId,
  origen: OrigenDeComprobante,
  emisorId: EmisorId,
  tipo: TipoDeComprobante,
): ClaveDeIdempotenciaDeComprobante {
  return {
    empresaId,
    origenTipo: origen.tipo,
    origenId: origen.id,
    emisorId,
    clase: claseDeComprobante(tipo),
  };
}

/**
 * Forma del comprobante emitido. Importes como `Importe` en el dominio (ADR-006). El número es
 * `bigint`: no es dinero, pero su tamaño máximo en ARCA es NO VERIFICADO.
 */
export type ComprobanteEmitido = Readonly<{
  empresaId: EmpresaId;
  emisorId: EmisorId;
  puntoDeVentaId: PuntoDeVentaId;
  tipo: TipoDeComprobante;
  /** `null` mientras está `PENDIENTE` (todavía sin número autorizado). */
  numero: bigint | null;
  estado: EstadoDeComprobante;
  origen: OrigenDeComprobante;
  emisor: InstantaneaDeEmisor;
  total: Importe;
  neto: Importe;
  iva: Importe;
}>;

/** El mismo comprobante en la frontera (JSON): importes como texto decimal, número como texto. */
export type ComprobanteEmitidoJson = Readonly<{
  empresaId: string;
  emisorId: string;
  puntoDeVentaId: string;
  tipo: TipoDeComprobante;
  numero: string | null;
  estado: EstadoDeComprobante;
  total: ImporteJson;
  neto: ImporteJson;
  iva: ImporteJson;
}>;
