import { fechaCivilHastaHoyDesdeTexto } from "../../../primitivas/tiempo/fecha-civil-hasta-hoy";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { leerImporte, textoDeImporte } from "./decimal";
import type { CampoDeHuella } from "./huella";
import { esUuid } from "./identificadores";
import { motivoDeAnulacionDesdeTexto } from "./registrar-compra";

/**
 * El pago mínimo de una factura (E9 §3.6, D142): se declara cuándo y con qué medio se pagó; el importe es el total del comprobante (un pago por factura, sin
 * parciales). Un pago en efectivo puede además SACAR la plata de una caja abierta (`salidaDeCaja`, T10b; DEC-0316): sin ella no mueve la caja. Pura: sin reloj ni azar (el «hoy» entra como dato).
 *
 * Los medios son los tipos de medio de caja (`caja/estados.ts`): compras no importa caja (la regla de módulos lo prohíbe), así que los copia y la prueba
 * `test/arquitectura/compras-fuente-unica.test.ts` falla si difieren. Los repite también el CHECK `medio_de_un_pago_medio_ck` de la base (lo compara `compras-persistencia.test.ts`).
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

/** Lo que dice la cabecera de un pago (CHECK `pago_medio_ck`): los medios más `COMPUESTO`, que solo pone el sistema cuando el pago tiene más de un medio; nunca viene del navegador (`MEDIOS_DE_PAGO` es lo que se elige). */
export const MEDIOS_DE_LA_CABECERA = [...MEDIOS_DE_PAGO, "COMPUESTO"] as const;
export type MedioDeLaCabecera = (typeof MEDIOS_DE_LA_CABECERA)[number];

export const esMedioDePago = (texto: string): texto is MedioDePago =>
  (MEDIOS_DE_PAGO as readonly string[]).includes(texto);

export type PagoPedido = Readonly<{ fechaDePago: string; medio: MedioDePago }>;
export type ErrorDePago = "FECHA_INVALIDA" | "MEDIO_INVALIDO";

const comoObjeto = (valor: unknown): Record<string, unknown> =>
  typeof valor === "object" && valor !== null && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : {};

/** La fecha del pago: civil y no futura según el «hoy» de Argentina de `ahora`. */
function leerFechaDePago(
  p: Record<string, unknown>,
  ahora: Date,
): Resultado<string, "FECHA_INVALIDA"> {
  const fecha = p["fechaDePago"];
  // `fechaCivilHastaHoyDesdeTexto` solo lee textos: se descarta antes lo que no lo es.
  if (typeof fecha !== "string" || !fechaCivilHastaHoyDesdeTexto(fecha, ahora).ok) {
    return err("FECHA_INVALIDA");
  }
  return ok(fecha);
}

/** La fecha del pago y su medio (uno de la lista). */
export function leerPago(valor: unknown, ahora: Date): Resultado<PagoPedido, ErrorDePago> {
  const p = comoObjeto(valor);
  const fecha = leerFechaDePago(p, ahora);
  if (!fecha.ok) return fecha;
  const medio = p["medio"];
  // `includes` compara con `===`: lo que no es un texto de la lista no pasa, sin mirar el tipo antes.
  if (!esMedioDePago(medio as string)) return err("MEDIO_INVALIDO");
  return ok({ fechaDePago: fecha.valor, medio: medio as MedioDePago });
}

/** Una línea ya resuelta de un pago: el medio y su importe en pesos (texto decimal de 2 decimales, mayor que cero). */
export type LineaDePago = Readonly<{ medio: MedioDePago; importe: string }>;

/** Un medio de un pago con su importe (texto decimal canónico de 2 decimales, mayor que cero); `null` es «el total de la factura» (el pago de un solo medio). */
export type MedioPedido = Readonly<{ medio: MedioDePago; importe: string | null }>;
export type PagoConMedios = Readonly<{ fechaDePago: string; medios: readonly MedioPedido[] }>;

/**
 * El pago con uno o varios medios (DEC-1280: un medio de cada tipo, a lo sumo uno por cada uno de la lista). O trae `medio` (un solo medio por el total de la factura) o trae `medios`
 * (cada uno con su importe, que el servidor compara con el total bajo bloqueo); las dos cosas juntas o ninguna no se admiten. Los medios salen ordenados como `MEDIOS_DE_PAGO`: la huella y el número
 * de línea no dependen del orden en que llegaron. Lo que no es de la lista, repetido o con un importe que no es un decimal positivo de 2 decimales, es `MEDIO_INVALIDO`.
 */
export function leerPagoConMedios(
  valor: unknown,
  ahora: Date,
): Resultado<PagoConMedios, ErrorDePago> {
  const p = comoObjeto(valor);
  if ((p["medio"] === undefined) === (p["medios"] === undefined)) {
    return err(p["fechaDePago"] === undefined ? "FECHA_INVALIDA" : "MEDIO_INVALIDO");
  }
  if (p["medios"] === undefined) {
    const uno = leerPago(valor, ahora);
    return uno.ok
      ? ok({
          fechaDePago: uno.valor.fechaDePago,
          medios: [{ medio: uno.valor.medio, importe: null }],
        })
      : uno;
  }
  const fecha = leerFechaDePago(p, ahora);
  if (!fecha.ok) return fecha;
  const crudos = p["medios"];
  if (!Array.isArray(crudos) || crudos.length === 0 || crudos.length > MEDIOS_DE_PAGO.length) {
    return err("MEDIO_INVALIDO");
  }
  const porMedio = new Map<MedioDePago, string>();
  for (const crudo of crudos as readonly unknown[]) {
    const m = comoObjeto(crudo);
    const medio = m["medio"];
    const importe = m["importe"];
    if (!esMedioDePago(medio as string) || porMedio.has(medio as MedioDePago)) {
      return err("MEDIO_INVALIDO");
    }
    const centavos = typeof importe === "string" ? leerImporte(importe) : null;
    if (centavos === null || centavos <= 0n) return err("MEDIO_INVALIDO");
    porMedio.set(medio as MedioDePago, textoDeImporte(centavos));
  }
  return ok({
    fechaDePago: fecha.valor,
    medios: MEDIOS_DE_PAGO.filter((m) => porMedio.has(m)).map((medio) => ({
      medio,
      importe: porMedio.get(medio) ?? "",
    })),
  });
}

export type ErrorDeLosMedios = "LA_SUMA_DE_LOS_MEDIOS_NO_ES_EL_TOTAL";

/**
 * Las líneas del pago con su importe contra el total de la factura que el servidor leyó bajo bloqueo: un medio sin importe lleva todo el total; con importes, la suma en centavos enteros tiene que ser EXACTAMENTE el total
 * (ni de más ni de menos). Un medio con importe y otro sin importe no se mezcla: `leerPagoConMedios` no los produce.
 */
export function resolverLosMedios(
  medios: readonly MedioPedido[],
  total: string,
): Resultado<readonly LineaDePago[], ErrorDeLosMedios> {
  const totalEnCentavos = leerImporte(total);
  if (totalEnCentavos === null) return err("LA_SUMA_DE_LOS_MEDIOS_NO_ES_EL_TOTAL");
  const lineas = medios.map((m) => ({ medio: m.medio, importe: m.importe ?? total }));
  const suma = lineas.reduce((acumulado, l) => acumulado + (leerImporte(l.importe) ?? 0n), 0n);
  return suma === totalEnCentavos ? ok(lineas) : err("LA_SUMA_DE_LOS_MEDIOS_NO_ES_EL_TOTAL");
}

/**
 * Lo que hay que pagar de una factura: su total menos lo que acreditan sus notas de crédito vigentes (`acreditado`), en centavos exactos (Q-3 del dueño, 25/11/2026: neto = total − notas de crédito; la nota de débito se paga aparte).
 * `null` si no queda nada para pagar (neto cero) o algún texto no es un importe: se paga solo un importe mayor que cero. Previene: pagar el total de una factura que el proveedor ya acreditó en parte o por entero.
 */
export function netoAPagar(total: string, acreditado: string): string | null {
  const t = leerImporte(total);
  const a = leerImporte(acreditado);
  if (t === null || a === null || t - a <= 0n) return null;
  return textoDeImporte(t - a);
}

/**
 * Si el pago vigente de una factura sigue cubriendo todo lo que se debe de ella DESPUÉS de anular una nota de crédito: el neto que quedaría (total − lo acreditado sin esa nota) no puede pasar de lo que se pagó.
 * Una nota que llegó después del pago (el pago es el total) se anula sin problema; una que el pago ya descontó, no: primero se anula el pago. Previene: una factura «pagada» con una deuda que nadie declaró.
 */
export function elPagoCubreSinLaNota(
  pagoImporte: string,
  total: string,
  acreditado: string,
  totalDeLaNota: string,
): boolean {
  const pagado = leerImporte(pagoImporte);
  const t = leerImporte(total);
  const a = leerImporte(acreditado);
  const n = leerImporte(totalDeLaNota);
  if (pagado === null || t === null || a === null || n === null) return false;
  return pagado >= t - (a - n);
}

/** El medio que dice la cabecera del pago: el único medio, o `COMPUESTO` si hay más de uno (el disparador de la base lo exige igual). */
export const medioDeLaCabecera = (medios: readonly { medio: MedioDePago }[]): MedioDeLaCabecera =>
  medios.length === 1 ? (medios[0] as { medio: MedioDePago }).medio : "COMPUESTO";

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

/**
 * Los campos del pago para la huella de su pedido: la fecha, los medios con lo que dijo quien paga (un medio sin importe es «el total», que NO entra: lo deriva el servidor bajo el bloqueo de la factura, así que
 * reintentar el mismo gesto después de que llegue una nota de crédito sigue siendo el mismo pedido, H-N3) y la salida de caja.
 */
export const camposDeHuellaDePago = (
  pago: PagoConMedios,
  salida: SalidaDeCaja | null = null,
): readonly CampoDeHuella[] => {
  const base = [
    pago.fechaDePago,
    ...pago.medios.map((m) => (m.importe === null ? m.medio : `${m.medio}:${m.importe}`)),
  ];
  return salida === null ? base : [...base, salida.cajaId, salida.motivo];
};
