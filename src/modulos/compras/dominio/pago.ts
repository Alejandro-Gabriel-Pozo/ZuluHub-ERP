import { fechaCivilHastaHoyDesdeTexto } from "../../../primitivas/tiempo/fecha-civil-hasta-hoy";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { CampoDeHuella } from "./huella";
import { esUuid } from "./identificadores";
import { motivoDeAnulacionDesdeTexto } from "./registrar-compra";

/**
 * El pago mínimo de una factura (E9 §3.6, D142): se declara cuándo y con qué medio se pagó; el importe es el total del comprobante (un pago por factura, sin
 * parciales). Un pago en efectivo puede además SACAR la plata de una caja abierta (`salidaDeCaja`, T10b; DEC-0316): sin ella no mueve la caja. Pura: sin reloj ni azar (el «hoy» entra como dato).
 *
 * Los medios son los tipos de medio de caja (`caja/estados.ts`): compras no importa caja (la regla de módulos lo prohíbe), así que los copia y la prueba
 * `test/arquitectura/compras-fuente-unica.test.ts` falla si difieren. Los repite también el CHECK `pago_medio_ck` de la base (lo compara `compras-persistencia.test.ts`).
 */
export const MEDIOS_DE_PAGO = [
  "EFECTIVO",
  "TARJETA_DEBITO",
  "TARJETA_CREDITO",
  "TRANSFERENCIA",
  "QR",
  "OTRO",
] as const;
export type MedioDePago = (typeof MEDIOS_DE_PAGO)[number];

export const esMedioDePago = (texto: string): texto is MedioDePago =>
  (MEDIOS_DE_PAGO as readonly string[]).includes(texto);

export type PagoPedido = Readonly<{ fechaDePago: string; medio: MedioDePago }>;
export type ErrorDePago = "FECHA_INVALIDA" | "MEDIO_INVALIDO";

/** La fecha del pago (civil, no futura según el «hoy» de Argentina de `ahora`) y su medio (uno de la lista). */
export function leerPago(valor: unknown, ahora: Date): Resultado<PagoPedido, ErrorDePago> {
  const p =
    typeof valor === "object" && valor !== null && !Array.isArray(valor)
      ? (valor as Record<string, unknown>)
      : {};
  const fecha = p["fechaDePago"];
  // `fechaCivilHastaHoyDesdeTexto` solo lee textos: se descarta antes lo que no lo es.
  if (typeof fecha !== "string" || !fechaCivilHastaHoyDesdeTexto(fecha, ahora).ok) {
    return err("FECHA_INVALIDA");
  }
  const medio = p["medio"];
  // `includes` compara con `===`: lo que no es un texto de la lista no pasa, sin mirar el tipo antes.
  if (!esMedioDePago(medio as string)) return err("MEDIO_INVALIDO");
  return ok({ fechaDePago: fecha, medio: medio as MedioDePago });
}

/** De qué caja sale el efectivo y con qué motivo (lo escribe quien paga: el sistema no inventa textos). */
export type SalidaDeCaja = Readonly<{ cajaId: string; motivo: string }>;
export type ErrorDeSalidaDeCaja = "SALIDA_DE_CAJA_INVALIDA" | "SALIDA_DE_CAJA_SOLO_EN_EFECTIVO";

/**
 * La salida de caja opcional de un pago: ausente (`undefined` o `null`) es «no mueve la caja»; presente exige el medio efectivo, un UUID de caja y un motivo
 * (la misma lectura de texto que el motivo de anulación: una línea, sin controles). Cualquier otra cosa es inválida: lo que no se declara no pasa.
 */
export function leerSalidaDeCaja(
  valor: unknown,
  medio: MedioDePago,
): Resultado<SalidaDeCaja | null, ErrorDeSalidaDeCaja> {
  if (valor === undefined || valor === null) return ok(null);
  const s =
    typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : {};
  const motivo = motivoDeAnulacionDesdeTexto(s["motivo"]);
  const cajaId = s["cajaId"];
  if (typeof cajaId !== "string" || !esUuid(cajaId) || !motivo.ok) {
    return err("SALIDA_DE_CAJA_INVALIDA");
  }
  if (medio !== "EFECTIVO") return err("SALIDA_DE_CAJA_SOLO_EN_EFECTIVO");
  return ok({ cajaId, motivo: motivo.valor });
}

/** Solo se paga una factura o una nota de débito: una nota de crédito no se paga. */
export const esClasePagable = (clase: string): boolean =>
  clase === "FACTURA" || clase === "NOTA_DE_DEBITO";

/** Los campos del pago para la huella de su pedido (con el importe, que es el del comprobante al declararlo). */
export const camposDeHuellaDePago = (
  pago: PagoPedido,
  importe: string,
  salida: SalidaDeCaja | null = null,
): readonly CampoDeHuella[] =>
  salida === null
    ? [pago.fechaDePago, pago.medio, importe]
    : [pago.fechaDePago, pago.medio, importe, salida.cajaId, salida.motivo];
