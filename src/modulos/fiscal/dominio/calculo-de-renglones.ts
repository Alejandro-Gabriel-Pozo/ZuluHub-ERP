import type { Cantidad } from "../../../primitivas/cantidad/cantidad";
import type { Porcentaje } from "../../../primitivas/cantidad/porcentaje";
import { type Importe, importeCero, restar, sumar } from "../../../primitivas/dinero/importe";
import type { Moneda } from "../../../primitivas/dinero/moneda";
import {
  exactoDeImporte,
  multiplicarPrecioPorCantidad,
  porcentajeDe,
  restarExactos,
  sumarExactos,
  type MontoExacto,
} from "../../../primitivas/dinero/monto-exacto";
import type { PrecioUnitario } from "../../../primitivas/dinero/precio-unitario";
import { prorratear } from "../../../primitivas/dinero/prorrateo";
import { redondear, type Politica } from "../../../primitivas/dinero/redondeo";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { CODIGOS_DE_ALICUOTA, porcentajeDeAlicuota, type CodigoDeAlicuota } from "./alicuota";
import { desglosarAlicuota, type DesgloseDeAlicuota } from "./comprobante";
import type { LetraDeComprobante } from "./comprobante-emitido";

/**
 * Cálculo de los renglones de una factura, con los dos modos de precio y con renglones sin alícuota
 * (letra C). Es el mismo algoritmo de ADR-006 que `calcularComprobante`, ampliado:
 * 1. cada renglón se calcula exacto, sin redondear;
 * 2. el total se redondea UNA sola vez, sobre la suma de los renglones exactos;
 * 3. ese total se prorratea entre los renglones (pesos = sus montos exactos);
 * 4. por alícuota: neto = redondear(total / (1 + a)), IVA = total − neto.
 *
 * Lo único que cambia entre los modos es el paso 1 (spec H7 facturación §B.3.3):
 * - `IVA_INCLUIDO`: el precio ya trae el IVA; el renglón es precio × cantidad × (1 − descuento).
 * - `IVA_DISCRIMINADO`: el precio es neto; el renglón es precio × cantidad × (1 − descuento) ×
 *   (1 + alícuota), exacto. Desde ahí es idéntico: no hay un segundo redondeo.
 *
 * Un renglón sin alícuota (`null`, solo en la letra C: el monotributista no discrimina IVA) no
 * lleva IVA: todo su importe es neto.
 */
export const MODOS_DE_PRECIO = ["IVA_INCLUIDO", "IVA_DISCRIMINADO"] as const;

export type ModoDePrecio = (typeof MODOS_DE_PRECIO)[number];

/**
 * Valor inicial del formulario según la letra (ASUMIDO, costo nulo): en A se carga el precio neto;
 * en B y C, el precio final.
 */
export function modoDePrecioInicial(letra: LetraDeComprobante): ModoDePrecio {
  return letra === "A" ? "IVA_DISCRIMINADO" : "IVA_INCLUIDO";
}

/** Lo que el cálculo necesita de un renglón. */
export type DatosDeCalculoDeRenglon = Readonly<{
  cantidad: Cantidad;
  precioUnitario: PrecioUnitario;
  descuento: Porcentaje | null;
  /** `null`: sin alícuota (letra C). */
  alicuota: CodigoDeAlicuota | null;
}>;

/**
 * Tope del total: `ImpTotal` es un `Double (13+2)` en WSFE v4.8 (l. 584), es decir trece dígitos
 * enteros y dos decimales: 9.999.999.999.999,99.
 */
export const TOPE_DE_TOTAL_EN_CENTAVOS = 10n ** 15n - 1n;

export type CalculoDeRenglones = Readonly<{
  total: Importe;
  /** Un importe por renglón, en el orden de entrada; suman exactamente `total`. */
  renglones: readonly Importe[];
  /** Solo las alícuotas que aparecen, en el orden de `CODIGOS_DE_ALICUOTA`. Los renglones sin alícuota no figuran. */
  desglose: readonly DesgloseDeAlicuota[];
  neto: Importe;
  iva: Importe;
}>;

/**
 * `monto × (1 + p / 100)`, exacto: la inversa de `quitarPorcentajeIncluido`. Se apoya en las
 * operaciones permitidas de las primitivas (suma y porcentaje exactos), así que no redondea.
 * Pendiente de integrar en `primitivas/dinero/monto-exacto.ts` (spec §B.1, tramo F1).
 */
export function agregarPorcentaje(monto: MontoExacto, porcentaje: Porcentaje): MontoExacto {
  return sumarExactos(monto, porcentajeDe(monto, porcentaje));
}

function montoExactoDeRenglon(
  moneda: Moneda,
  renglon: DatosDeCalculoDeRenglon,
  modo: ModoDePrecio,
): MontoExacto {
  const bruto = multiplicarPrecioPorCantidad(moneda, renglon.precioUnitario, renglon.cantidad);
  const conDescuento =
    renglon.descuento === null
      ? bruto
      : restarExactos(bruto, porcentajeDe(bruto, renglon.descuento));
  if (modo === "IVA_INCLUIDO" || renglon.alicuota === null) return conDescuento;
  const porcentaje = porcentajeDeAlicuota(renglon.alicuota);
  return porcentaje === null ? conDescuento : agregarPorcentaje(conDescuento, porcentaje);
}

/**
 * Calcula los renglones. `TOTAL_FUERA_DE_RANGO` si el total no es positivo o no entra en
 * `TOPE_DE_TOTAL_EN_CENTAVOS` (una factura de cero pesos no se informa a ARCA; una nota se informa
 * siempre en positivo).
 */
export function calcularRenglones(
  moneda: Moneda,
  renglones: readonly DatosDeCalculoDeRenglon[],
  modo: ModoDePrecio,
  politica: Politica,
): Resultado<CalculoDeRenglones, "TOTAL_FUERA_DE_RANGO"> {
  const exactos = renglones.map((renglon) => montoExactoDeRenglon(moneda, renglon, modo));
  const sumaExacta = exactos.reduce(sumarExactos, exactoDeImporte(importeCero(moneda)));
  // Antes de redondear: un total desmesurado no puede ni construirse como `Importe`.
  if (sumaExacta.numerador / sumaExacta.denominador > TOPE_DE_TOTAL_EN_CENTAVOS) {
    return err("TOTAL_FUERA_DE_RANGO");
  }
  const total = redondear(sumaExacta, politica);
  if (total.unidades <= 0n || total.unidades > TOPE_DE_TOTAL_EN_CENTAVOS) {
    return err("TOTAL_FUERA_DE_RANGO");
  }
  const importes = prorratear(total, exactos);

  const desglose = CODIGOS_DE_ALICUOTA.flatMap((codigo) => {
    // Stryker disable next-line OptionalChaining: `importes` y `renglones` tienen el mismo largo; el `?.` solo satisface noUncheckedIndexedAccess
    const delaAlicuota = importes.filter((_, posicion) => renglones[posicion]?.alicuota === codigo);
    if (delaAlicuota.length === 0) return [];
    return [desglosarAlicuota(codigo, delaAlicuota.reduce(sumar, importeCero(moneda)), politica)];
  });
  // Lo que no lleva alícuota (letra C) es todo neto y no tiene IVA.
  const sinAlicuota = restar(
    total,
    desglose.reduce((acumulado, d) => sumar(acumulado, d.total), importeCero(moneda)),
  );

  return ok({
    total,
    renglones: importes,
    desglose,
    neto: desglose.reduce((acumulado, d) => sumar(acumulado, d.neto), sinAlicuota),
    iva: desglose.reduce((acumulado, d) => sumar(acumulado, d.iva), importeCero(moneda)),
  });
}
