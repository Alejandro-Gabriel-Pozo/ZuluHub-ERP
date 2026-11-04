import { importeCero, restar, sumar, type Importe } from "../../../primitivas/dinero/importe";
import { claseDeComprobante, type TipoDeComprobante } from "./comprobante-emitido";
import type { EstadoDeComprobanteArca } from "./estados-de-comprobante";

/**
 * Lo ya acreditado de una factura (o nota de débito) por sus notas de crédito (decisiones D-11, D-12, D-15 y D-16 del
 * facturador): una cifra exacta y una etiqueta calculada. La factura original NO cambia de estado: la etiqueta se
 * deduce siempre de las notas, nunca se guarda. Una sola regla en un solo lugar: el detalle y el listado la llaman
 * con lo que leyeron y no vuelven a decidir qué nota cuenta.
 *
 * - No hay tope: lo acreditado puede superar el total (D-11); entonces la etiqueta es `TOTAL`, sin aviso.
 * - Solo restan las notas de CRÉDITO. Una nota de débito que cita al comprobante no acredita nada.
 */

export const ETIQUETAS_DE_ACREDITACION = ["NINGUNA", "PARCIAL", "TOTAL"] as const;
export type EtiquetaDeAcreditacion = (typeof ETIQUETAS_DE_ACREDITACION)[number];

/**
 * Qué estado de una nota de crédito cuenta como acreditado. `Record` exhaustivo a propósito: un estado nuevo del
 * comprobante no compila hasta que alguien decida si cuenta (previene que una nota en un estado nuevo quede sin
 * contar, o contada, sin que nadie lo haya decidido).
 *
 *  - `AUTORIZADO` cuenta. Las pendientes cuentan (D-15, confirmada por el dueño): `PENDIENTE` y `EN_VALIDACION`
 *    («Validando») e `INCIERTO` («Confirmando»); si ARCA la rechaza (`RECHAZADO`) deja de contar.
 *  - `DESCARTADO` no cuenta: nunca existió para ARCA.
 *  - `CONFLICTO` («Número usado por otro sistema»): el dueño no lo decidió. Se cuenta como pendiente, porque todavía
 *    puede emitirse (reintentar la devuelve a `PENDIENTE`) y D-15 quiere evitar mostrar de menos mientras no es
 *    definitivo; deja de contar si se la descarta. PREGUNTA ABIERTA al dueño.
 */
export const CUENTA_COMO_ACREDITADA: Readonly<Record<EstadoDeComprobanteArca, boolean>> = {
  PENDIENTE: true,
  EN_VALIDACION: true,
  AUTORIZADO: true,
  INCIERTO: true,
  CONFLICTO: true,
  RECHAZADO: false,
  DESCARTADO: false,
};

/** Una nota que cita al comprobante, como la leen la consulta y el listado (o varias del mismo estado ya sumadas). */
export type NotaParaAcreditar = Readonly<{
  tipo: TipoDeComprobante;
  estado: EstadoDeComprobanteArca;
  total: Importe;
}>;

/** Lo acreditado: la suma exacta de las notas de crédito que cuentan (cero si ninguna). */
export function acreditadoPor(notas: readonly NotaParaAcreditar[], total: Importe): Importe {
  let acreditado = importeCero(total.moneda);
  for (const nota of notas) {
    if (claseDeComprobante(nota.tipo) === "NOTA_CREDITO" && CUENTA_COMO_ACREDITADA[nota.estado]) {
      acreditado = sumar(acreditado, nota.total);
    }
  }
  return acreditado;
}

/**
 * `NINGUNA` si no se acreditó nada, `TOTAL` si lo acreditado iguala o supera el total de la factura, y `PARCIAL`
 * entre medio.
 */
export function etiquetaDeAcreditacion(
  total: Importe,
  acreditado: Importe,
): EtiquetaDeAcreditacion {
  if (acreditado.unidades <= 0n) return "NINGUNA";
  return restar(total, acreditado).unidades <= 0n ? "TOTAL" : "PARCIAL";
}

export type Acreditacion = Readonly<{ acreditado: Importe; etiqueta: EtiquetaDeAcreditacion }>;

/**
 * Lo acreditado y su etiqueta para un comprobante de ese `tipo` y `total`, dadas las notas que lo citan. Una nota de
 * crédito en sí no se acredita (no admite notas encima: `ASOCIADO_NO_ASOCIABLE`): devuelve `null`.
 */
export function acreditacionDe(
  tipo: TipoDeComprobante,
  total: Importe,
  notas: readonly NotaParaAcreditar[],
): Acreditacion | null {
  if (claseDeComprobante(tipo) === "NOTA_CREDITO") return null;
  const acreditado = acreditadoPor(notas, total);
  return { acreditado, etiqueta: etiquetaDeAcreditacion(total, acreditado) };
}
