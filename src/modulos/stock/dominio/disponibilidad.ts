import { calidadHabilita, type CalidadDeLote } from "./calidad";

/**
 * Lo DISPONIBLE de un lote (E6 §3.2, S-3): existencia en un depósito de uso `NORMAL`, de un lote cuya calidad lo habilita (sin calidad o
 * liberado) y que no esté vencido. Una fecha de vencimiento vale HASTA EL FINAL de su día («Vence hoy» está a la venta, D118). Las fechas
 * son civiles (`AAAA-MM-DD`), se comparan como texto y contra la `fecha_de_negocio` de la jornada, nunca contra la hora UTC. Es UNA regla:
 * la usan la elección de lotes, la consulta de existencias y el puerto de existencia para mostrar. Previene que dos pantallas muestren
 * un número distinto, o que se venda un lote rechazado.
 */
export type LoteParaDisponibilidad = Readonly<{
  calidad: CalidadDeLote | null;
  /** `AAAA-MM-DD`, o `null` si no vence. */
  vence: string | null;
}>;

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
export const esFechaCivil = (texto: string): boolean => FECHA.test(texto);

export const estaVencido = (vence: string | null, fechaDeNegocio: string): boolean =>
  (vence ?? fechaDeNegocio) < fechaDeNegocio;

export const esDisponible = (lote: LoteParaDisponibilidad, fechaDeNegocio: string): boolean =>
  calidadHabilita(lote.calidad) && !estaVencido(lote.vence, fechaDeNegocio);

/** Días enteros de jornada hasta el vencimiento (negativo: ya venció). Cuenta jornadas civiles, no horas. */
export function diasHastaElVencimiento(vence: string, fechaDeNegocio: string): number {
  const dia = (texto: string): number =>
    Date.UTC(Number(texto.slice(0, 4)), Number(texto.slice(5, 7)) - 1, Number(texto.slice(8, 10))) /
    86_400_000;
  return dia(vence) - dia(fechaDeNegocio);
}
