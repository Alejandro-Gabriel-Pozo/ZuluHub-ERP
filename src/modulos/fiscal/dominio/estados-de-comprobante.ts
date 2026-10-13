import type { Importe } from "../../../primitivas/dinero/importe";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import type { AlicuotaParaArca } from "./importes-para-arca";

/**
 * Ciclo del comprobante frente a ARCA (spec H7 facturación §B.2): una sola tabla con estos siete
 * estados. `RECHAZADO` es terminal: corregir es un comprobante nuevo. «Reconciliado» no es un
 * estado: es cómo terminó un `INCIERTO` o un `EN_VALIDACION`.
 *
 * Reemplaza al `EstadoDeComprobante` de `comprobante-emitido.ts` (cuatro valores) cuando se
 * integre; hasta entonces conviven y este lleva el sufijo `Arca`.
 */
export const ESTADOS_DE_COMPROBANTE_ARCA = [
  "PENDIENTE",
  "EN_VALIDACION",
  "AUTORIZADO",
  "RECHAZADO",
  "INCIERTO",
  "CONFLICTO",
  "DESCARTADO",
] as const;

export type EstadoDeComprobanteArca = (typeof ESTADOS_DE_COMPROBANTE_ARCA)[number];

/**
 * Transiciones permitidas (§B.2.2). La base impone la misma tabla con un disparador y una prueba
 * compara ambas. `AUTORIZADO`, `RECHAZADO` y `DESCARTADO` no salen.
 */
export const TRANSICIONES_DE_COMPROBANTE: Readonly<
  Record<EstadoDeComprobanteArca, readonly EstadoDeComprobanteArca[]>
> = {
  PENDIENTE: ["EN_VALIDACION", "DESCARTADO"],
  EN_VALIDACION: ["AUTORIZADO", "RECHAZADO", "INCIERTO", "PENDIENTE", "CONFLICTO"],
  INCIERTO: ["AUTORIZADO", "PENDIENTE", "CONFLICTO"],
  CONFLICTO: ["PENDIENTE", "DESCARTADO"],
  AUTORIZADO: [],
  RECHAZADO: [],
  DESCARTADO: [],
};

export function transicionDeComprobanteValida(
  de: EstadoDeComprobanteArca,
  a: EstadoDeComprobanteArca,
): boolean {
  return TRANSICIONES_DE_COMPROBANTE[de].includes(a);
}

/**
 * ¿Cuenta para la identidad `(empresa, origen, emisor, clase)`? Vigente es todo comprobante que no
 * quedó `RECHAZADO` ni `DESCARTADO`: esos dos liberan el origen para emitir uno nuevo (§0, punto 2).
 */
export function esComprobanteVigente(estado: EstadoDeComprobanteArca): boolean {
  return estado !== "RECHAZADO" && estado !== "DESCARTADO";
}

/** Un código y un texto de ARCA, crudos: la traducción para el usuario es de la pantalla. */
export type Mensaje = Readonly<{ codigo: number; texto: string }>;

/**
 * Cómo termina un pedido de autorización (§B.5.2). `NO_ENVIADO` es nuevo: ARCA seguro no lo
 * procesó (la conexión no llegó a mandar el cuerpo), así que el número se libera y se reintenta.
 */
export type ResultadoDeAutorizacionArca =
  | Readonly<{
      tipo: "AUTORIZADO";
      codigo: string;
      vence: FechaCivil;
      fecha: FechaCivil;
      observaciones: readonly Mensaje[];
    }>
  | Readonly<{
      tipo: "RECHAZADO";
      errores: readonly Mensaje[];
      observaciones: readonly Mensaje[];
    }>
  | Readonly<{ tipo: "INCIERTO"; motivo: string }>
  | Readonly<{ tipo: "NO_ENVIADO"; motivo: string }>;

/** Cómo terminó el pedido, sin el detalle: es lo que la serie necesita para cerrar la reserva. */
export type DesenlaceDeAutorizacion = ResultadoDeAutorizacionArca["tipo"];

/**
 * El estado en que queda un comprobante `EN_VALIDACION` según la respuesta: cada desenlace es una
 * transición válida de la tabla. `NO_ENVIADO` lo devuelve a `PENDIENTE`.
 */
export function estadoTrasAutorizacion(
  resultado: ResultadoDeAutorizacionArca,
): EstadoDeComprobanteArca {
  return resultado.tipo === "NO_ENVIADO" ? "PENDIENTE" : resultado.tipo;
}

/**
 * Lo que ARCA tiene registrado de un número (`FECompConsultar`), en los términos de ZuluHub salvo
 * lo que ARCA devuelve como código (tipo de comprobante, tipo de documento, moneda), que el adaptador
 * no interpreta y la reconciliación compara con la tabla de `codigos-de-arca.ts`.
 */
export type DatosConsultados = Readonly<{
  tipoDeComprobante: number;
  puntoDeVenta: number;
  numero: bigint;
  fecha: FechaCivil;
  tipoDeDocumento: number;
  numeroDeDocumento: bigint;
  moneda: string;
  total: Importe;
  neto: Importe;
  iva: Importe;
  alicuotas: readonly AlicuotaParaArca[];
  asociado: Readonly<{
    tipoDeComprobante: number;
    puntoDeVenta: number;
    numero: bigint;
    cuit: string;
    fecha: FechaCivil;
  }> | null;
}>;

/**
 * Respuesta de la consulta de un número (§B.3.7). `NO_ENCONTRADO` es solo el código 602 («no
 * existen datos»), inequívoco; el 601 («CUIT representada no incluida en token») y cualquier otra
 * falla son `CONSULTA_FALLIDA`: no se sabe, se reintenta.
 */
export type ResultadoDeConsulta =
  | Readonly<{ tipo: "ENCONTRADO"; datos: DatosConsultados; codigo: string; vence: FechaCivil }>
  | Readonly<{ tipo: "NO_ENCONTRADO" }>
  | Readonly<{ tipo: "CONSULTA_FALLIDA"; detalle: string }>;
