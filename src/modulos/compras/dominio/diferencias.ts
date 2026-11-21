import { dividirRedondeando } from "../../../primitivas/cantidad/redondeo-entero";
import { POLITICA_VIGENTE } from "../../../primitivas/dinero/redondeo";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import {
  leerCantidad,
  leerImporte,
  leerPrecio,
  textoDeCantidad,
  textoDeImporte,
  textoDePrecio,
  UNO_DE_CANTIDAD,
  UNO_DE_IMPORTE,
  UNO_DE_PRECIO,
} from "./decimal";
import { motivoDeAnulacionDesdeTexto } from "./registrar-compra";

/**
 * Las tolerancias y las diferencias de la conciliación de tres vías (N4, E9 §3.8). Pura: sin reloj ni azar; todo en enteros exactos (ADR-006). Decisiones del dueño (14 y 16/11/2026):
 * sin tolerancias por defecto (un valor ausente es «no definida», que NO es cero: toda diferencia queda abierta); el precio de referencia es el de la línea de la ORDEN si la recepción
 * es contra una orden y, si no, el de la RECEPCIÓN; nunca se descarta una diferencia en silencio (dentro de la tolerancia queda registrada y resuelta con rastro).
 */

/** Porcentajes (cantidad, precio, recepción) de 0 a 100 con hasta 4 decimales y el importe en pesos (≥ 0, 2 decimales); `null` = no definida. */
export type Tolerancias = Readonly<{
  cantidad: string | null;
  precio: string | null;
  importe: string | null;
  recepcion: string | null;
}>;

export const SIN_TOLERANCIAS: Tolerancias = {
  cantidad: null,
  precio: null,
  importe: null,
  recepcion: null,
};

export type ErrorDeTolerancia = "TOLERANCIA_INVALIDA";

const CIEN_POR_CIENTO = 100n * UNO_DE_CANTIDAD;

function leerPorcentaje(valor: unknown): Resultado<string | null, ErrorDeTolerancia> {
  if (valor === undefined || valor === null) return ok(null);
  const unidades = typeof valor === "string" ? leerCantidad(valor) : null;
  if (unidades === null || unidades > CIEN_POR_CIENTO) return err("TOLERANCIA_INVALIDA");
  return ok(textoDeCantidad(unidades));
}

function leerImporteMaximo(valor: unknown): Resultado<string | null, ErrorDeTolerancia> {
  if (valor === undefined || valor === null) return ok(null);
  const unidades = typeof valor === "string" ? leerImporte(valor) : null;
  if (unidades === null || unidades < 0n) return err("TOLERANCIA_INVALIDA");
  return ok(textoDeImporte(unidades));
}

/** Lee las tolerancias que fija el gerente: cada una ausente o `null` es «no definida»; lo que no es un decimal en su rango es `TOLERANCIA_INVALIDA`. Los textos salen canónicos. */
export function leerTolerancias(valor: unknown): Resultado<Tolerancias, ErrorDeTolerancia> {
  // Un texto o un número como «registro» no tiene ninguno de los campos: queda todo en «no definida».
  const t = (typeof valor === "object" && valor !== null ? valor : {}) as Record<string, unknown>;
  const cantidad = leerPorcentaje(t["cantidad"]);
  const precio = leerPorcentaje(t["precio"]);
  const importe = leerImporteMaximo(t["importe"]);
  const recepcion = leerPorcentaje(t["recepcion"]);
  if (!cantidad.ok) return cantidad;
  if (!precio.ok) return precio;
  if (!importe.ok) return importe;
  if (!recepcion.ok) return recepcion;
  return ok({
    cantidad: cantidad.valor,
    precio: precio.valor,
    importe: importe.valor,
    recepcion: recepcion.valor,
  });
}

// ---- las diferencias ---------------------------------------------------------------------------------------------------------------

export type TipoDeDiferencia = "FACTURADO_DISTINTO_DE_LO_RECIBIDO" | "PRECIO_DISTINTO";
export type OrigenDelPrecioDeReferencia = "ORDEN" | "RECEPCION";

export type LineaConciliada = Readonly<{
  numero: number;
  /** Lo facturado en la línea (decimal de 4). */
  facturada: string;
  /** El precio neto de la línea, por unidad base (decimal de 6). */
  precioNeto: string;
  /** Lo asignado a la línea DESPUÉS de esta conciliación, sumadas todas sus conciliaciones vivas (decimal de 4). */
  asignada: string;
  /**
   * ¿Queda mercadería recibida de este producto (del mismo proveedor, confirmada y no rechazada) sin asignar a ninguna factura? Mientras quede, la factura puede estar
   * conciliándose por partes (una factura con varios remitos): lo facturado de más NO se mide todavía, para no inventar diferencias. Se mide cuando ya no queda nada por asignar.
   */
  recibidoSinAsignar: boolean;
}>;

export type AsignacionConciliada = Readonly<{
  lineaDeFactura: number;
  recepcionId: string;
  lineaDeRecepcion: number;
  /** Lo asignado en este acto (decimal de 4). */
  cantidad: string;
  /** El precio contra el que se compara (decimal de 6) y de dónde sale; `null` si no hay precio de referencia (no se compara: no se inventa uno). */
  referencia: Readonly<{ precio: string; origen: OrigenDelPrecioDeReferencia }> | null;
}>;

export type DiferenciaCalculada = Readonly<{
  tipo: TipoDeDiferencia;
  lineaDeComprobante: number;
  recepcionId: string | null;
  lineaDeRecepcion: number | null;
  /** Con signo: en `FACTURADO_DISTINTO_DE_LO_RECIBIDO`, lo facturado de más; en `PRECIO_DISTINTO`, la cantidad a la que se aplica la diferencia de precio. */
  cantidadDeDiferencia: string;
  /** Con signo, en pesos y redondeado una vez a centavos con la política vigente. */
  importeDeDiferencia: string;
  precioFacturado: string | null;
  precioDeReferencia: string | null;
  origenDelPrecioDeReferencia: OrigenDelPrecioDeReferencia | null;
  dentroDeTolerancia: boolean;
}>;

const ESCALA_DEL_IMPORTE_DE_UN_PRECIO_POR_UNA_CANTIDAD =
  (UNO_DE_PRECIO * UNO_DE_CANTIDAD) / UNO_DE_IMPORTE;
// Stryker disable next-line EqualityOperator: con cero el signo no cambia el resultado
const absoluto = (n: bigint): bigint => (n < 0n ? -n : n);

/** Centavos de `precio × cantidad` (un solo redondeo, política vigente). */
const centavosDe = (precio: bigint, cantidad: bigint): bigint =>
  dividirRedondeando(
    precio * cantidad,
    ESCALA_DEL_IMPORTE_DE_UN_PRECIO_POR_UNA_CANTIDAD,
    POLITICA_VIGENTE,
  );

/**
 * ¿Dentro de la tolerancia? Solo cuentan las tolerancias definidas y TODAS las definidas tienen que cumplirse; sin ninguna definida, nunca (queda abierta). `porcentaje` es la
 * diferencia contra su base y `importe` la diferencia en centavos; la tolerancia de porcentaje no se cumple contra una base en cero.
 */
function estaDentro(
  porcentajeAplicable: string | null,
  importeAplicable: string | null,
  diferencia: bigint,
  base: bigint,
  importe: bigint,
): boolean {
  let definidas = 0;
  if (porcentajeAplicable !== null) {
    definidas += 1;
    const unidades = leerCantidad(porcentajeAplicable) as bigint;
    if (absoluto(diferencia) * CIEN_POR_CIENTO > unidades * base) return false;
  }
  if (importeAplicable !== null) {
    definidas += 1;
    if (absoluto(importe) > (leerImporte(importeAplicable) as bigint)) return false;
  }
  return definidas > 0;
}

/**
 * Las diferencias de una conciliación, en un orden fijo (las de cantidad por línea de la factura, después las de precio por asignación). Por cada línea de la factura
 * conciliada que ya no tiene recibido sin asignar (`recibidoSinAsignar`): si queda facturado más de lo asignado, `FACTURADO_DISTINTO_DE_LO_RECIBIDO` (el ejemplo del dueño: factura de 10,
 * asignados 9,6, diferencia de 0,4; una conciliación parcial por remitos no mide nada todavía, decisión del orquestador del 16/11/2026). Por cada asignación con
 * precio de referencia cuyo precio facturado difiere, `PRECIO_DISTINTO`. Lo que no difiere no genera nada. `FACTURADO_Y_NO_RECIBIDO` no se calcula acá: una conciliación no puede
 * llevar una línea sin asignación (la factura sin recepción es el estado «Facturada, falta recibir»). Los datos que no son decimales válidos no se interpretan: `lineas` y
 * `asignaciones` los arma el caso de uso con lo guardado.
 */
export function calcularDiferencias(
  lineas: readonly LineaConciliada[],
  asignaciones: readonly AsignacionConciliada[],
  tolerancias: Tolerancias,
): readonly DiferenciaCalculada[] {
  const calculadas: DiferenciaCalculada[] = [];
  const conciliadas = new Set(asignaciones.map((a) => a.lineaDeFactura));
  for (const linea of [...lineas].sort((a, b) => a.numero - b.numero)) {
    if (!conciliadas.has(linea.numero) || linea.recibidoSinAsignar) continue;
    const facturada = leerCantidad(linea.facturada) as bigint;
    const asignada = leerCantidad(linea.asignada) as bigint;
    const diferencia = facturada - asignada;
    if (diferencia <= 0n) continue;
    const importe = centavosDe(leerPrecio(linea.precioNeto) as bigint, diferencia);
    calculadas.push({
      tipo: "FACTURADO_DISTINTO_DE_LO_RECIBIDO",
      lineaDeComprobante: linea.numero,
      recepcionId: null,
      lineaDeRecepcion: null,
      cantidadDeDiferencia: textoDeCantidad(diferencia),
      importeDeDiferencia: textoDeImporte(importe),
      precioFacturado: null,
      precioDeReferencia: null,
      origenDelPrecioDeReferencia: null,
      dentroDeTolerancia: estaDentro(
        tolerancias.cantidad,
        tolerancias.importe,
        diferencia,
        asignada,
        importe,
      ),
    });
  }
  for (const a of asignaciones) {
    if (a.referencia === null) continue;
    const linea = lineas.find((l) => l.numero === a.lineaDeFactura) as LineaConciliada;
    const facturado = leerPrecio(linea.precioNeto) as bigint;
    const referencia = leerPrecio(a.referencia.precio) as bigint;
    const diferenciaDePrecio = facturado - referencia;
    if (diferenciaDePrecio === 0n) continue;
    const cantidad = leerCantidad(a.cantidad) as bigint;
    const importe = centavosDe(diferenciaDePrecio, cantidad);
    calculadas.push({
      tipo: "PRECIO_DISTINTO",
      lineaDeComprobante: a.lineaDeFactura,
      recepcionId: a.recepcionId,
      lineaDeRecepcion: a.lineaDeRecepcion,
      cantidadDeDiferencia: textoDeCantidad(cantidad),
      importeDeDiferencia: textoDeImporte(importe),
      precioFacturado: textoDePrecio(facturado),
      precioDeReferencia: textoDePrecio(referencia),
      origenDelPrecioDeReferencia: a.referencia.origen,
      dentroDeTolerancia: estaDentro(
        tolerancias.precio,
        tolerancias.importe,
        diferenciaDePrecio,
        referencia,
        importe,
      ),
    });
  }
  return calculadas;
}

// ---- resolver una diferencia -------------------------------------------------------------------------------------------------------

/**
 * Las resoluciones que elige una persona (las siete del dueño del 14/11/2026 menos `DENTRO_DE_TOLERANCIA`, que solo la asigna el sistema al registrar la diferencia). «Dejar abierta» es
 * no resolver. `NOTA_DE_CREDITO` y `DEVOLUCION` son por ahora la etiqueta: los documentos llegan con sus tramos.
 */
export const RESOLUCIONES_MANUALES = [
  "ACEPTADA",
  "NOTA_DE_CREDITO",
  "NOTA_DE_DEBITO",
  "DEVOLUCION",
  "FACTURA_COMPLEMENTARIA",
  "CORREGIDA_POR_EL_PROVEEDOR",
] as const;
export type ResolucionManual = (typeof RESOLUCIONES_MANUALES)[number];
export type ErrorDeResolucion = "RESOLUCION_INVALIDA" | "MOTIVO_REQUERIDO";

export type ResolucionPedida = Readonly<{ resolucion: ResolucionManual; motivo: string }>;

export function leerResolucion(
  resolucion: unknown,
  motivo: unknown,
): Resultado<ResolucionPedida, ErrorDeResolucion> {
  if (!(RESOLUCIONES_MANUALES as readonly unknown[]).includes(resolucion)) {
    return err("RESOLUCION_INVALIDA");
  }
  const texto = motivoDeAnulacionDesdeTexto(motivo);
  if (!texto.ok) return texto;
  return ok({ resolucion: resolucion as ResolucionManual, motivo: texto.valor });
}
