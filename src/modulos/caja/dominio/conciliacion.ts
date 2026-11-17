import { importeCero, restar, sumar, type Importe } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import type { EstadoDeConteo } from "../estados";
import type { MovimientoParaArqueo } from "./arqueo";
import { filaVigente } from "./correccion";
import type { ParDeCobro } from "./medios";
import { negarImporte, sumarImportes } from "./importes";

/**
 * La conciliación por medio de una jornada (e3b §4.4): por cada (medio, cuenta) lo REGISTRADO (Σ de los movimientos de las sesiones),
 * las CORRECCIONES de medio (+importe en el par de destino, −importe en el de origen), lo DECLARADO y la DIFERENCIA =
 * declarado − (registrado + correcciones), al centavo y en `bigint`. Es el espejo EXACTO de lo que `cierre_de_caja_verificar` de la base
 * recalcula al confirmar el cierre del día (`caja_conciliacion_no_cuadra`). Puro: sin reloj ni azar.
 */

/** Una corrección de medio: el cobro (su importe) pasó de `antes` a `despues`. */
export type CorreccionParaConciliacion = Readonly<{
  importe: Importe;
  antes: ParDeCobro;
  despues: ParDeCobro;
}>;

export type DeclaracionVista = Readonly<
  ParDeCobro & {
    secuencia: number;
    importe: Importe;
  }
>;

/** Lo que dejó el cierre de una caja para un par (medio, cuenta): lo contado, o el conforme con quién y cuándo. */
export type CierreDeCajaDelPar = Readonly<ParDeCobro> &
  (
    | Readonly<{ conforme: false; contado: Importe }>
    | Readonly<{ conforme: true; conformePor: string; conformeEn: Date }>
  );

export type EntradaDeConciliacion = Readonly<{
  efectivoId: string;
  /** Todos los movimientos de las sesiones de la sucursal y la fecha. */
  movimientos: readonly MovimientoParaArqueo[];
  correcciones: readonly CorreccionParaConciliacion[];
  /** Todas las declaraciones de la jornada (rige la de mayor secuencia por par). */
  declaraciones: readonly DeclaracionVista[];
  /** El «conforme general» de la jornada (uno solo), si se dio. */
  conformeGeneral: Readonly<{ por: string; en: Date }> | null;
  /** Las líneas de arqueo de todas las sesiones de la jornada. */
  cierres: readonly CierreDeCajaDelPar[];
}>;

export type LineaDeConciliacion = Readonly<{
  medioDePagoId: string;
  cuentaDeCobroId: string | null;
  registrado: Importe;
  correcciones: Importe;
  /** `null` si es `CONFORME` o `SIN_DATO`. */
  declarado: Importe | null;
  estado: EstadoDeConteo;
  conformePor: string | null;
  conformeEn: Date | null;
  /** declarado − (registrado + correcciones); `null` si `CONFORME` (muestra «conforme») o `SIN_DATO`. */
  diferencia: Importe | null;
}>;

function llaveDelPar(par: ParDeCobro): string {
  return JSON.stringify([par.medioDePagoId, par.cuentaDeCobroId]);
}

/** Agrupa por par conservando el orden de llegada dentro de cada grupo. */
function agruparPorPar<T extends ParDeCobro>(
  filas: readonly T[],
): ReadonlyMap<string, readonly T[]> {
  const grupos = new Map<string, T[]>();
  for (const fila of filas) {
    const llave = llaveDelPar(fila);
    grupos.set(llave, [...(grupos.get(llave) ?? []), fila]);
  }
  return grupos;
}

type Conteo = Readonly<{
  estado: EstadoDeConteo;
  declarado: Importe | null;
  conformePor: string | null;
  conformeEn: Date | null;
}>;

const SIN_DATO: Conteo = {
  estado: "SIN_DATO",
  declarado: null,
  conformePor: null,
  conformeEn: null,
};

const declarado = (importe: Importe): Conteo => ({
  estado: "DECLARADO",
  declarado: importe,
  conformePor: null,
  conformeEn: null,
});

const conforme = (por: string, en: Date): Conteo => ({
  estado: "CONFORME",
  declarado: null,
  conformePor: por,
  conformeEn: en,
});

/** Σ de lo contado de las cajas (las líneas conformes no suman: no tienen contado). */
function sumaDeContados(cierres: readonly CierreDeCajaDelPar[]): Importe {
  return sumarImportes(cierres.flatMap((c) => (c.conforme ? [] : [c.contado])));
}

/**
 * Cómo se sabe el total de un par (e3b §4.4, en este orden). El efectivo es siempre `CONTADO` (la suma de lo contado por billetes en
 * cada caja). Los demás: (1) la declaración vigente del par → `DECLARADO`; (2) si no, el conforme general de la jornada → `CONFORME`;
 * (3) si no, lo derivado de los cierres de caja: todas las líneas del par contadas → `DECLARADO` con la suma; todas conformes →
 * `CONFORME` con quién y cuándo del último; mezcla → `SIN_DATO`; (4) sin nada → `SIN_DATO`. La declaración explícita gana siempre
 * sobre el conforme general. Previene un total inventado y que un conforme tape una declaración.
 */
function conteoDelPar(
  par: ParDeCobro,
  entrada: EntradaDeConciliacion,
  declaracionVigente: DeclaracionVista | null,
  cierres: readonly CierreDeCajaDelPar[],
): Conteo {
  if (par.medioDePagoId === entrada.efectivoId) {
    return { ...declarado(sumaDeContados(cierres)), estado: "CONTADO" };
  }
  if (declaracionVigente !== null) return declarado(declaracionVigente.importe);
  if (entrada.conformeGeneral !== null) {
    return conforme(entrada.conformeGeneral.por, entrada.conformeGeneral.en);
  }
  const contadas = cierres.filter((c) => !c.conforme);
  if (cierres.length > 0 && contadas.length === cierres.length) {
    return declarado(sumaDeContados(cierres));
  }
  const conformes = cierres.flatMap((c) => (c.conforme ? [c] : []));
  if (cierres.length > 0 && conformes.length === cierres.length) {
    const ultimo = conformes.reduce((mejor, c) => (c.conformeEn > mejor.conformeEn ? c : mejor));
    return conforme(ultimo.conformePor, ultimo.conformeEn);
  }
  return SIN_DATO;
}

/** Suma `importe` al acumulado del par. */
function acumular(mapa: Map<string, Importe>, par: ParDeCobro, importe: Importe): void {
  const llave = llaveDelPar(par);
  mapa.set(llave, sumar(mapa.get(llave) ?? importeCero(ARS), importe));
}

/**
 * La conciliación de la jornada: una línea por cada par (medio, cuenta) con movimientos, correcciones o declaración, ordenada por par.
 * La diferencia solo existe donde hay un total (`CONTADO` o `DECLARADO`).
 */
export function conciliarJornada(entrada: EntradaDeConciliacion): readonly LineaDeConciliacion[] {
  const pares = new Map<string, ParDeCobro>();
  const registrado = new Map<string, Importe>();
  const correcciones = new Map<string, Importe>();
  for (const m of entrada.movimientos) {
    pares.set(llaveDelPar(m), {
      medioDePagoId: m.medioDePagoId,
      cuentaDeCobroId: m.cuentaDeCobroId,
    });
    acumular(registrado, m, m.importe);
  }
  for (const c of entrada.correcciones) {
    for (const par of [c.antes, c.despues]) pares.set(llaveDelPar(par), par);
    acumular(correcciones, c.antes, negarImporte(c.importe));
    acumular(correcciones, c.despues, c.importe);
  }
  const declaracionesPorPar = agruparPorPar(entrada.declaraciones);
  for (const declaracion of entrada.declaraciones) {
    pares.set(llaveDelPar(declaracion), {
      medioDePagoId: declaracion.medioDePagoId,
      cuentaDeCobroId: declaracion.cuentaDeCobroId,
    });
  }
  const cierresPorPar = agruparPorPar(entrada.cierres);

  return [...pares.keys()].sort().map((llave) => {
    const par = pares.get(llave) as ParDeCobro;
    const conteo = conteoDelPar(
      par,
      entrada,
      filaVigente(declaracionesPorPar.get(llave) ?? []),
      cierresPorPar.get(llave) ?? [],
    );
    const registradoDelPar = registrado.get(llave) ?? importeCero(ARS);
    const correccionesDelPar = correcciones.get(llave) ?? importeCero(ARS);
    return {
      medioDePagoId: par.medioDePagoId,
      cuentaDeCobroId: par.cuentaDeCobroId,
      registrado: registradoDelPar,
      correcciones: correccionesDelPar,
      ...conteo,
      diferencia:
        conteo.declarado === null
          ? null
          : restar(conteo.declarado, sumar(registradoDelPar, correccionesDelPar)),
    };
  });
}

/**
 * ¿Hay que explicar esta línea? Sí si no hay dato o si la diferencia es distinta de cero. Las `CONFORME` no (no hay diferencia que
 * explicar). Es lo que cuenta `caja.conciliacion_por_medio` y a lo que se copia la explicación al congelar.
 */
export function lineaPorExplicar(l: Pick<LineaDeConciliacion, "estado" | "diferencia">): boolean {
  return l.estado === "SIN_DATO" || (l.diferencia !== null && l.diferencia.unidades !== 0n);
}

/** Cuántas líneas hay que explicar en el control `caja.conciliacion_por_medio` (ver `lineaPorExplicar`). */
export function cantidadDeLineasPorExplicar(
  lineas: readonly Pick<LineaDeConciliacion, "estado" | "diferencia">[],
): number {
  return lineas.filter(lineaPorExplicar).length;
}
