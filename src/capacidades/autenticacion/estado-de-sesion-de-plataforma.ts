import { segundoFactorRecienteHastaMs } from "./ventanas-de-segundo-factor";
import { LIMITES_DE_SESION_DE_PLATAFORMA, type LimitesDeSesion } from "./vigencia-de-sesion";

/**
 * El estado de la sesión de la consola, lo que la pantalla necesita para avisar ANTES de que venza (h5-p8 §3):
 * `{ vigente, venceEnMs, motivo, segundoFactorRecienteHastaMs }`. Pura: sale de las fechas de la sesión y del reloj.
 *
 *  - `venceEnMs`: cuánto falta para que deje de valer, el menor de tres plazos: la inactividad (desde el último uso),
 *    el tope absoluto de 8 horas (desde que se creó; no se renueva) y el vencimiento guardado en la base.
 *  - `motivo`: cuál de los dos primeros se cumple antes. El tope manda si empatan (es el que no se puede renovar
 *    usando la sesión, así que la pantalla no debe ofrecer «Seguir»).
 *  - `segundoFactorRecienteHastaMs`: lo que le queda a la ventana de 5 minutos del segundo factor, o 0.
 *  - Sin sesión legible, o vencida: `vigente: false`, `venceEnMs: 0` y `segundoFactorRecienteHastaMs: 0`.
 *
 * Es la misma cuenta que `vigenciaDeSesion` (una sesión vigente acá lo es allá): una sola decisión, dos formas.
 */

export type MotivoDeVencimiento = "INACTIVIDAD" | "TOPE_DE_8_HORAS";

export type EstadoDeSesionDePlataforma = Readonly<{
  vigente: boolean;
  venceEnMs: number;
  motivo: MotivoDeVencimiento;
  segundoFactorRecienteHastaMs: number;
}>;

export type DatosDeSesionDePlataforma = Readonly<{
  creadaEn: Date;
  ultimoUso: Date;
  venceEn: Date;
  segundoFactorEn: Date | null;
}>;

/**
 * Sin sesión (sin cookie, cookie vieja, sesión borrada) no se sabe por qué: la cookie vence por inactividad, que es
 * lo más probable, y la pantalla hace lo mismo en los dos casos (vuelve al ingreso).
 */
export const SIN_SESION_DE_PLATAFORMA: EstadoDeSesionDePlataforma = Object.freeze({
  vigente: false,
  venceEnMs: 0,
  motivo: "INACTIVIDAD",
  segundoFactorRecienteHastaMs: 0,
});

export function estadoDeSesionDePlataforma(
  sesion: DatosDeSesionDePlataforma | null,
  ahora: Date,
  limites: LimitesDeSesion = LIMITES_DE_SESION_DE_PLATAFORMA,
): EstadoDeSesionDePlataforma {
  if (sesion === null) return SIN_SESION_DE_PLATAFORMA;
  const instante = ahora.getTime();
  const porInactividad =
    sesion.ultimoUso.getTime() + limites.inactividad.vencimientoEnMs - instante;
  const porTope = sesion.creadaEn.getTime() + limites.absolutoEnMs - instante;
  const porGuardado = sesion.venceEn.getTime() - instante;
  const restante = Math.min(porInactividad, porTope, porGuardado);
  const motivo: MotivoDeVencimiento = porTope <= porInactividad ? "TOPE_DE_8_HORAS" : "INACTIVIDAD";
  // `!(restante > 0)`: una fecha inválida (NaN) cae en «no vigente» y no en «vigente».
  if (!(restante > 0)) {
    return { vigente: false, venceEnMs: 0, motivo, segundoFactorRecienteHastaMs: 0 };
  }
  return {
    vigente: true,
    venceEnMs: restante,
    motivo,
    segundoFactorRecienteHastaMs: segundoFactorRecienteHastaMs(sesion.segundoFactorEn, ahora),
  };
}
