import type { Importe, ImporteJson } from "../../../primitivas/dinero/importe";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { TipoDeMedio } from "../estados";
import { importeDeEntrada, type ErrorDeImporte } from "./importes";
import type { ParDeCobro } from "./medios";

/**
 * Corrección de medio de un cobro y declaración de totales (e3b §4.3 y §4.4): dos registros nuevos que nunca tocan lo original
 * (movimientos y arqueos quedan como se contaron) y solo mueven la conciliación del día. Cada cambio es una fila con `secuencia + 1`;
 * lo vigente es la de mayor secuencia. Puro: sin reloj ni azar.
 */

/** La secuencia de la fila nueva: la mayor de las que hay más uno (la primera es 1). La base exige que siga sin huecos. */
export function secuenciaSiguiente(secuencias: readonly number[]): number {
  return Math.max(0, ...secuencias) + 1;
}

/** La fila vigente de una lista con secuencia (la de mayor secuencia), o `null` si no hay. */
export function filaVigente<T extends Readonly<{ secuencia: number }>>(
  filas: readonly T[],
): T | null {
  return filas.reduce<T | null>(
    (vigente, fila) => (vigente === null || fila.secuencia > vigente.secuencia ? fila : vigente),
    null,
  );
}

export type CorreccionGuardada = Readonly<{ secuencia: number; despues: ParDeCobro }>;

/** El (medio, cuenta) vigente de un cobro: el destino de su última corrección o, si no hubo, el original. */
export function parVigenteDelCobro(
  original: ParDeCobro,
  correcciones: readonly CorreccionGuardada[],
): ParDeCobro {
  return filaVigente(correcciones)?.despues ?? original;
}

export type CorreccionArmada = Readonly<{
  antes: ParDeCobro;
  despues: ParDeCobro;
  secuencia: number;
}>;

/**
 * Traslada el importe completo del cobro del par vigente a otro: `antes` es el vigente y `secuencia` la siguiente. Corregir a lo que ya
 * es vigente no cambia nada (`MEDIO_DEL_COBRO_SIN_CAMBIOS`; la base lo repite en `correccion_de_medio_cambia_ck`). Que el destino sea un
 * medio y cuenta válidos lo decide `validarParDeCobro`; que la jornada esté en auditoría, el caso de uso.
 */
export function decidirCorreccionDeMedio(
  entrada: Readonly<{
    original: ParDeCobro;
    correcciones: readonly CorreccionGuardada[];
    destino: ParDeCobro;
  }>,
): Resultado<CorreccionArmada, "MEDIO_DEL_COBRO_SIN_CAMBIOS"> {
  const antes = parVigenteDelCobro(entrada.original, entrada.correcciones);
  const { destino } = entrada;
  if (
    destino.medioDePagoId === antes.medioDePagoId &&
    destino.cuentaDeCobroId === antes.cuentaDeCobroId
  ) {
    return err("MEDIO_DEL_COBRO_SIN_CAMBIOS");
  }
  return ok({
    antes,
    despues: destino,
    secuencia: secuenciaSiguiente(entrada.correcciones.map((c) => c.secuencia)),
  });
}

export type DeclaracionArmada = Readonly<{ importe: Importe; secuencia: number }>;

/**
 * Una declaración de total (e3b §4.4): el total que dice el resumen de la terminal, del QR o del banco por (medio, cuenta). El efectivo
 * NO se declara (su total es lo contado por billetes al cerrar cada caja): `MEDIO_NO_DECLARABLE`. Importe >= 0 y dentro del tope.
 */
export function decidirDeclaracion(
  entrada: Readonly<{
    tipoDeMedio: TipoDeMedio;
    importe: ImporteJson;
    secuenciasDelPar: readonly number[];
  }>,
): Resultado<DeclaracionArmada, "MEDIO_NO_DECLARABLE" | ErrorDeImporte> {
  if (entrada.tipoDeMedio === "EFECTIVO") return err("MEDIO_NO_DECLARABLE");
  const importe = importeDeEntrada(entrada.importe, "NO_NEGATIVO");
  if (!importe.ok) return importe;
  return ok({ importe: importe.valor, secuencia: secuenciaSiguiente(entrada.secuenciasDelPar) });
}
