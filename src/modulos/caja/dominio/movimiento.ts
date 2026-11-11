import type { Importe, ImporteJson } from "../../../primitivas/dinero/importe";
import { sumar } from "../../../primitivas/dinero/importe";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import type { EstadoDeJornada } from "../../cierre/publico";
import type { ClaseDeMovimiento } from "../estados";
import { importeDeEntrada, negarImporte, type ErrorDeImporte } from "./importes";
import { motivoObligatorio } from "./texto";

/**
 * Los movimientos de caja (e3 §3.1 y §3.2): qué signo lleva cada clase, cuáles piden motivo, cuáles son solo de efectivo y cómo se
 * arman el fondo, los ingresos, los egresos y los ajustes. Puro: sin reloj ni azar. El signo y el motivo los repite la base
 * (`movimiento_caja_signo_ck`, `movimiento_caja_motivo_requerido_ck`, `movimiento_caja_solo_efectivo`): una prueba compara las tres.
 */

/**
 * La regla de signo de cada clase: cobro e ingreso entran (> 0); el egreso sale (< 0); el fondo es >= 0; el ajuste y la anulación
 * tienen signo pero nunca cero. Previene un movimiento que la base rechazaría tarde y un egreso que suma.
 */
const SIGNO_VALIDO: Readonly<Record<ClaseDeMovimiento, (centavos: bigint) => boolean>> = {
  COBRO: (centavos) => centavos > 0n,
  INGRESO_MANUAL: (centavos) => centavos > 0n,
  EGRESO_MANUAL: (centavos) => centavos < 0n,
  FONDO_INICIAL: (centavos) => centavos >= 0n,
  AJUSTE: (centavos) => centavos !== 0n,
  ANULACION: (centavos) => centavos !== 0n,
};

export function signoValido(clase: ClaseDeMovimiento, importe: Importe): boolean {
  return SIGNO_VALIDO[clase](importe.unidades);
}

/** Las clases que piden un motivo (L673-674 de `caja-y-cobros.md`): ingreso, egreso, ajuste y anulación. */
export const CLASES_CON_MOTIVO: readonly ClaseDeMovimiento[] = [
  "INGRESO_MANUAL",
  "EGRESO_MANUAL",
  "AJUSTE",
  "ANULACION",
];

/** Las clases de un movimiento que se puede anular desde caja: ingreso, egreso y ajuste (nunca el fondo, una anulación ni un cobro). */
export const CLASES_ANULABLES: readonly ClaseDeMovimiento[] = [
  "INGRESO_MANUAL",
  "EGRESO_MANUAL",
  "AJUSTE",
];

/** El fondo y los ingresos y egresos manuales son solo de efectivo. */
const CLASES_SOLO_EFECTIVO: readonly ClaseDeMovimiento[] = [
  "FONDO_INICIAL",
  "INGRESO_MANUAL",
  "EGRESO_MANUAL",
];

export function motivoRequerido(clase: ClaseDeMovimiento): boolean {
  return CLASES_CON_MOTIVO.includes(clase);
}

export function esSoloDeEfectivo(clase: ClaseDeMovimiento): boolean {
  return CLASES_SOLO_EFECTIVO.includes(clase);
}

/** El fondo con el que se abre la sesión: ARS, >= 0 (puede ser cero). No se anula: se corrige con un ajuste. */
export function decidirFondoInicial(fondo: ImporteJson): Resultado<Importe, ErrorDeImporte> {
  return importeDeEntrada(fondo, "NO_NEGATIVO");
}

export type MovimientoManualArmado = Readonly<{
  clase: "INGRESO_MANUAL" | "EGRESO_MANUAL";
  /** Con signo: el ingreso suma, el egreso resta. */
  importe: Importe;
  motivo: string;
}>;

/** Ingreso o egreso manual (solo efectivo): el monto que llega es positivo, el egreso se guarda negativo. Con motivo. */
export function decidirMovimientoManual(
  entrada: Readonly<{
    sentido: "INGRESO" | "EGRESO";
    importe: ImporteJson;
    motivo: string | null | undefined;
  }>,
): Resultado<MovimientoManualArmado, ErrorDeImporte | "MOTIVO_INVALIDO"> {
  const monto = importeDeEntrada(entrada.importe, "POSITIVO");
  if (!monto.ok) return monto;
  const motivo = motivoObligatorio(entrada.motivo);
  if (!motivo.ok) return motivo;
  return entrada.sentido === "INGRESO"
    ? ok({ clase: "INGRESO_MANUAL", importe: monto.valor, motivo: motivo.valor })
    : ok({ clase: "EGRESO_MANUAL", importe: negarImporte(monto.valor), motivo: motivo.valor });
}

/**
 * Un egreso mayor al efectivo esperado se PERMITE (el esperado puede quedar negativo) pero deja una entrada de auditoría
 * `EGRESO_SUPERA_EFECTIVO` (SUPUESTO (DEC-0027) de e3 §3.2; la auditoría vio un egreso de $ 999.999.999 aceptado sin aviso). `egreso` es el
 * importe con signo (negativo).
 */
export function egresoSuperaElEfectivo(efectivoEsperado: Importe, egreso: Importe): boolean {
  return sumar(efectivoEsperado, egreso).unidades < 0n;
}

export type ErrorDeJornadaACorregir =
  | "JORNADA_A_CORREGIR_NO_ENCONTRADA"
  | "JORNADA_A_CORREGIR_NO_CERRADA"
  | "JORNADA_A_CORREGIR_NO_ANTERIOR";

/**
 * El enlace de un ajuste a una jornada ya cerrada (`corrigeJornada`, e3 §3.11.3): la jornada existe, está `CERRADA` y es ANTERIOR a la
 * fecha de negocio de la sesión de hoy. Mismo orden que `movimiento_caja_validar_alta` de la base. Previene que se «corrija» una jornada
 * que todavía se puede corregir dentro de ella (con la corrección de medio) o una futura.
 */
export function validarJornadaACorregir(
  corrige: FechaCivil,
  jornada: Readonly<{ estado: EstadoDeJornada }> | null,
  fechaDeLaSesion: FechaCivil,
): Resultado<null, ErrorDeJornadaACorregir> {
  if (jornada === null) return err("JORNADA_A_CORREGIR_NO_ENCONTRADA");
  if (jornada.estado !== "CERRADA") return err("JORNADA_A_CORREGIR_NO_CERRADA");
  // `YYYY-MM-DD` ordena como texto igual que como fecha.
  if (corrige >= fechaDeLaSesion) return err("JORNADA_A_CORREGIR_NO_ANTERIOR");
  return ok(null);
}

export type AjusteArmado = Readonly<{
  importe: Importe;
  motivo: string;
  corrigeJornada: FechaCivil | null;
}>;

/**
 * Un ajuste: importe con signo distinto de cero (cualquier medio), motivo obligatorio y, si corrige una jornada cerrada, el enlace
 * validado. Solo gerente y administrador lo registran (el permiso es del caso de uso).
 */
export function decidirAjuste(
  entrada: Readonly<{
    importe: ImporteJson;
    motivo: string | null | undefined;
    corrigeJornada: FechaCivil | null;
    /** La jornada `corrigeJornada` de la sucursal de la caja, si existe. */
    jornadaACorregir: Readonly<{ estado: EstadoDeJornada }> | null;
    fechaDeLaSesion: FechaCivil;
  }>,
): Resultado<AjusteArmado, ErrorDeImporte | "MOTIVO_INVALIDO" | ErrorDeJornadaACorregir> {
  const importe = importeDeEntrada(entrada.importe, "CON_SIGNO_NO_CERO");
  if (!importe.ok) return importe;
  const motivo = motivoObligatorio(entrada.motivo);
  if (!motivo.ok) return motivo;
  if (entrada.corrigeJornada !== null) {
    const enlace = validarJornadaACorregir(
      entrada.corrigeJornada,
      entrada.jornadaACorregir,
      entrada.fechaDeLaSesion,
    );
    if (!enlace.ok) return enlace;
  }
  return ok({
    importe: importe.valor,
    motivo: motivo.valor,
    corrigeJornada: entrada.corrigeJornada,
  });
}
