import { ErrorDeValor } from "../../../primitivas/cantidad/errores";
import {
  importeCero,
  importeDesdeJson,
  restar,
  sumar,
  type Importe,
  type ImporteJson,
} from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";

/**
 * Los importes de caja (e3 §3.1, §3.5 y §3.9). Todo en `bigint` de centavos con `Importe` (ADR-006): el texto decimal entra por
 * `importeDesdeJson`, que rechaza `10.001`, `-0`, `1e3`, `5400abc` y monedas que no son ARS, y acá se suma el tope y el signo que
 * pide cada operación. El tope es el de `movimiento_caja_tope_ck` y `declaracion_de_total_importe_ck`: 999.999.999,99.
 * Previene: la falla medida en el prototipo (importes sin tope que perdían centavos) y un importe que la base rechazaría tarde.
 */
export const TOPE_DE_IMPORTE_EN_CENTAVOS = 99_999_999_999n;

export type ErrorDeImporte = "IMPORTE_INVALIDO" | "MONEDA_NO_SOPORTADA";

/** Qué signo admite la operación: cobro, ingreso y egreso (el monto) > 0; fondo y contados >= 0; ajuste con signo <> 0. */
export type ReglaDeImporte = "POSITIVO" | "NO_NEGATIVO" | "CON_SIGNO_NO_CERO";

const ADMITE: Readonly<Record<ReglaDeImporte, (centavos: bigint) => boolean>> = {
  POSITIVO: (centavos) => centavos > 0n,
  NO_NEGATIVO: (centavos) => centavos >= 0n,
  CON_SIGNO_NO_CERO: (centavos) => centavos !== 0n,
};

/**
 * El importe que llegó de la frontera, validado: ARS, hasta dos decimales, dentro del tope y con el signo de la regla. Un valor que la
 * primitiva rechaza es `IMPORTE_INVALIDO` (o `MONEDA_NO_SOPORTADA` si el problema es la moneda); cualquier otro fallo se propaga.
 */
export function importeDeEntrada(
  json: ImporteJson,
  regla: ReglaDeImporte,
): Resultado<Importe, ErrorDeImporte> {
  let importe: Importe;
  try {
    importe = importeDesdeJson(json);
  } catch (error) {
    if (!(error instanceof ErrorDeValor)) throw error;
    return err(error.codigo === "MONEDA_NO_SOPORTADA" ? "MONEDA_NO_SOPORTADA" : "IMPORTE_INVALIDO");
  }
  const centavos = importe.unidades;
  const fueraDelTope =
    centavos > TOPE_DE_IMPORTE_EN_CENTAVOS || centavos < -TOPE_DE_IMPORTE_EN_CENTAVOS;
  if (fueraDelTope || !ADMITE[regla](centavos)) {
    return err("IMPORTE_INVALIDO");
  }
  return ok(importe);
}

export function sumarImportes(importes: readonly Importe[]): Importe {
  return importes.reduce((suma, importe) => sumar(suma, importe), importeCero(ARS));
}

export function negarImporte(importe: Importe): Importe {
  return restar(importeCero(ARS), importe);
}
