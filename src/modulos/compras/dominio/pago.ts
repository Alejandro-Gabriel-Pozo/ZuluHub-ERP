import { fechaCivilHastaHoyDesdeTexto } from "../../../primitivas/tiempo/fecha-civil-hasta-hoy";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { CampoDeHuella } from "./huella";

/**
 * El pago mínimo de una factura (E9 §3.6, D142): se declara cuándo y con qué medio se pagó; el importe es el total del comprobante (un pago por factura, sin
 * parciales). NO mueve la caja en esta etapa. Pura: sin reloj ni azar (el «hoy» entra como dato).
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

/** Solo se paga una factura o una nota de débito: una nota de crédito no se paga. */
export const esClasePagable = (clase: string): boolean =>
  clase === "FACTURA" || clase === "NOTA_DE_DEBITO";

/** Los campos del pago para la huella de su pedido (con el importe, que es el del comprobante al declararlo). */
export const camposDeHuellaDePago = (
  pago: PagoPedido,
  importe: string,
): readonly CampoDeHuella[] => [pago.fechaDePago, pago.medio, importe];
