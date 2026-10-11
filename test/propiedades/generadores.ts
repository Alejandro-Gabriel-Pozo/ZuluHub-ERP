import fc from "fast-check";
import { cantidadDesdeTexto, type Cantidad } from "../../src/primitivas/cantidad/cantidad";
import { formatearDecimalFijo } from "../../src/primitivas/cantidad/decimal-fijo";
import { porcentajeDesdeTexto, type Porcentaje } from "../../src/primitivas/cantidad/porcentaje";
import { importeDesdeTexto, type Importe } from "../../src/primitivas/dinero/importe";
import { ARS } from "../../src/primitivas/dinero/moneda";
import {
  exactoDeImporte,
  multiplicarPrecioPorCantidad,
  type MontoExacto,
} from "../../src/primitivas/dinero/monto-exacto";
import {
  precioUnitarioDesdeTexto,
  type PrecioUnitario,
} from "../../src/primitivas/dinero/precio-unitario";
import { CODIGOS_DE_ALICUOTA, type LineaDeComprobante } from "../../src/modulos/fiscal/publico";

const MAXIMO = 10n ** 18n - 1n;

/** Valores extremos que siempre se prueban: cero, un centavo, el máximo de numeric(18,x). */
const unidadesExtremas = [0n, 1n, 2n, 99n, 100n, 101n, MAXIMO, MAXIMO - 1n];

const unidades = (maximo: bigint) =>
  fc.oneof(
    { weight: 2, arbitrary: fc.bigInt({ min: 0n, max: maximo }) },
    { weight: 1, arbitrary: fc.constantFrom(...unidadesExtremas.filter((u) => u <= maximo)) },
    { weight: 2, arbitrary: fc.bigInt({ min: 0n, max: 100_000n }) },
  );

export const importeArbitrario: fc.Arbitrary<Importe> = unidades(MAXIMO).map((u) =>
  importeDesdeTexto(ARS, formatearDecimalFijo(u, 2)),
);

/** Importes chicos, para sumar muchos sin salir del rango. */
export const importeChico: fc.Arbitrary<Importe> = fc
  .bigInt({ min: 0n, max: 10_000_000n })
  .map((u) => importeDesdeTexto(ARS, formatearDecimalFijo(u, 2)));

const precioArbitrario: fc.Arbitrary<PrecioUnitario> = fc
  .oneof(fc.bigInt({ min: 0n, max: 10n ** 12n }), fc.constantFrom(0n, 1n, 9_950_000n, 3_500_000n))
  .map((u) => precioUnitarioDesdeTexto(formatearDecimalFijo(u, 6)));

const cantidadArbitraria: fc.Arbitrary<Cantidad> = fc
  .oneof(fc.bigInt({ min: 0n, max: 10n ** 9n }), fc.constantFrom(0n, 1n, 10_000n, 30_000n))
  .map((u) => cantidadDesdeTexto(formatearDecimalFijo(u, 4)));

const porcentajeArbitrario: fc.Arbitrary<Porcentaje> = fc
  .oneof(fc.bigInt({ min: 0n, max: 1_000_000n }), fc.constantFrom(0n, 1n, 100_000n, 210_000n))
  .map((u) => porcentajeDesdeTexto(formatearDecimalFijo(u, 4)));

/** Montos exactos con fracciones (precio × cantidad): el caso donde se acumulan los empates. */
export const montoExactoArbitrario: fc.Arbitrary<MontoExacto> = fc
  .tuple(precioArbitrario, cantidadArbitraria)
  .map(([precio, cantidad]) => multiplicarPrecioPorCantidad(ARS, precio, cantidad));

export const pesoArbitrario: fc.Arbitrary<MontoExacto> = fc.oneof(
  montoExactoArbitrario,
  importeChico.map(exactoDeImporte),
);

/** Líneas con precios y cantidades razonables, para que el total no se salga del rango. */
export const lineaRazonable: fc.Arbitrary<LineaDeComprobante> = fc.record(
  {
    precioUnitario: fc
      .bigInt({ min: 0n, max: 100_000_000_000n })
      .map((u) => precioUnitarioDesdeTexto(formatearDecimalFijo(u, 6))),
    cantidad: fc
      .bigInt({ min: 0n, max: 1_000_000n })
      .map((u) => cantidadDesdeTexto(formatearDecimalFijo(u, 4))),
    descuento: porcentajeArbitrario,
    alicuota: fc.constantFrom(...CODIGOS_DE_ALICUOTA),
  },
  { requiredKeys: ["precioUnitario", "cantidad", "alicuota"] },
);
