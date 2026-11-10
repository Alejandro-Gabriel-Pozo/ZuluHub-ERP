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

/**
 * Qué estado de una nota de crédito cuenta como acreditado FIRME: la pregunta de «¿ese comprobante sigue valiendo?»
 * (`vigenciaDeComprobantes`, D-F-1; decisión de diseño DD-2 de E1). Solo cuenta `AUTORIZADO`. Es una tabla aparte de
 * `CUENTA_COMO_ACREDITADA` a propósito: aquella cuenta también las notas pendientes para no MOSTRAR de menos (D-15), pero para decidir que
 * la factura dejó de valer, y que quien factura pueda emitir otra, una nota todavía sin autorizar no alcanza: si ARCA la rechazara, la
 * factura original seguiría valiendo y se habría emitido una segunda (doble facturación). `Record` exhaustivo, igual que la otra: un
 * estado nuevo del comprobante no compila hasta que alguien decida si cuenta. Chequeo: `acreditacion.test.ts` y
 * `facturacion-vigencia.test.ts` (una nota en vuelo no deja la factura no vigente).
 */
export const CUENTA_COMO_ACREDITADA_FIRME: Readonly<Record<EstadoDeComprobanteArca, boolean>> = {
  PENDIENTE: false,
  EN_VALIDACION: false,
  AUTORIZADO: true,
  INCIERTO: false,
  CONFLICTO: false,
  RECHAZADO: false,
  DESCARTADO: false,
};

/** Una nota que cita al comprobante, como la leen la consulta y el listado (o varias del mismo estado ya sumadas). */
export type NotaParaAcreditar = Readonly<{
  tipo: TipoDeComprobante;
  estado: EstadoDeComprobanteArca;
  total: Importe;
}>;

/** Cuál de las dos tablas decide qué estado de una nota de crédito cuenta (`CUENTA_COMO_ACREDITADA` o `CUENTA_COMO_ACREDITADA_FIRME`). */
export type CuentaDeAcreditacion = Readonly<Record<EstadoDeComprobanteArca, boolean>>;

/** Lo acreditado: la suma exacta de las notas de crédito que cuentan según `cuenta` (cero si ninguna). */
export function acreditadoPor(
  notas: readonly NotaParaAcreditar[],
  total: Importe,
  cuenta: CuentaDeAcreditacion,
): Importe {
  let acreditado = importeCero(total.moneda);
  for (const nota of notas) {
    if (claseDeComprobante(nota.tipo) === "NOTA_CREDITO" && cuenta[nota.estado]) {
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
  cuenta: CuentaDeAcreditacion,
): Acreditacion | null {
  if (claseDeComprobante(tipo) === "NOTA_CREDITO") return null;
  const acreditado = acreditadoPor(notas, total, cuenta);
  return { acreditado, etiqueta: etiquetaDeAcreditacion(total, acreditado) };
}

export const MOTIVOS_DE_NO_VIGENCIA = ["DESCARTADO", "RECHAZADO", "ACREDITADO_TOTAL"] as const;
export type MotivoDeNoVigencia = (typeof MOTIVOS_DE_NO_VIGENCIA)[number];

/**
 * Por qué un comprobante dejó de valer, o `null` si sigue vigente (D-F-1): `DESCARTADO` y `RECHAZADO` salen del estado; un comprobante
 * `AUTORIZADO` deja de valer si lo acreditan por completo notas de crédito AUTORIZADAS (`CUENTA_COMO_ACREDITADA_FIRME`, DD-2). Los
 * demás estados (`PENDIENTE`, `EN_VALIDACION`, `INCIERTO` y `CONFLICTO`) son vigentes: están en camino a ARCA y no se factura dos veces.
 * Una nota PARCIAL no lo deja de valer (decisión 175). Una nota de crédito no se acredita (`acreditacionDe` da `null`): vigente.
 */
export function motivoDeNoVigencia(
  comprobante: Readonly<{
    tipo: TipoDeComprobante;
    estado: EstadoDeComprobanteArca;
    total: Importe;
  }>,
  notas: readonly NotaParaAcreditar[],
): MotivoDeNoVigencia | null {
  if (comprobante.estado === "DESCARTADO") return "DESCARTADO";
  if (comprobante.estado === "RECHAZADO") return "RECHAZADO";
  const acreditacion = acreditacionDe(
    comprobante.tipo,
    comprobante.total,
    notas,
    CUENTA_COMO_ACREDITADA_FIRME,
  );
  return acreditacion?.etiqueta === "TOTAL" ? "ACREDITADO_TOTAL" : null;
}
