/**
 * Inactividad de la sesión del mostrador (W1). Decisión del dueño: la sesión vence a los 15 minutos
 * sin uso. El aviso «¿Seguís ahí?» sale a los 12 minutos: es un SUPUESTO declarado (3 minutos antes
 * del vencimiento), que el dueño puede cambiar sin tocar el código que decide, porque los límites son
 * un parámetro. Función pura: la hora actual entra como dato (nunca se lee el reloj acá), así que se
 * prueba y se muta sin esperar y da lo mismo en el servidor que en el navegador.
 */

const MINUTO_EN_MS = 60_000;

export type LimitesDeInactividad = Readonly<{
  /** Desde cuánta inactividad (inclusive) corresponde avisar «¿Seguís ahí?». */
  avisoEnMs: number;
  /** Desde cuánta inactividad (inclusive) la sesión está vencida. */
  vencimientoEnMs: number;
}>;

/** Los valores del dueño: vence a los 15 minutos; el aviso, a los 12 (supuesto: 3 minutos antes). */
export const LIMITES_DE_INACTIVIDAD: LimitesDeInactividad = Object.freeze({
  avisoEnMs: 12 * MINUTO_EN_MS,
  vencimientoEnMs: 15 * MINUTO_EN_MS,
});

export type EstadoDeInactividad = "VIGENTE" | "POR_VENCER" | "VENCIDA";

function limitesValidos({ avisoEnMs, vencimientoEnMs }: LimitesDeInactividad): boolean {
  return (
    Number.isFinite(avisoEnMs) &&
    Number.isFinite(vencimientoEnMs) &&
    avisoEnMs > 0 &&
    avisoEnMs < vencimientoEnMs
  );
}

/**
 * Cómo está la sesión según cuánto hace que se usó por última vez.
 *
 * - Menos que `avisoEnMs` de inactividad: `VIGENTE`.
 * - Desde `avisoEnMs` y menos que `vencimientoEnMs`: `POR_VENCER` (se muestra el aviso).
 * - Desde `vencimientoEnMs`: `VENCIDA`.
 *
 * Falla cerrado: una fecha inválida (no se sabe cuándo se usó) cuenta como `VENCIDA`. Un último uso
 * posterior a `ahora` (reloj del cliente atrasado) cuenta como inactividad cero: `VIGENTE`. Límites
 * incoherentes (el aviso no es menor que el vencimiento, o no son positivos) lanzan `RangeError`:
 * es un error de programación, no un dato del usuario.
 */
export function estadoDeInactividad(
  ultimoUso: Date,
  ahora: Date,
  limites: LimitesDeInactividad = LIMITES_DE_INACTIVIDAD,
): EstadoDeInactividad {
  if (!limitesValidos(limites)) {
    throw new RangeError(
      "límites de inactividad inválidos: el aviso debe ser menor que el vencimiento",
    );
  }
  const inactividad = ahora.getTime() - ultimoUso.getTime();
  if (Number.isNaN(inactividad)) return "VENCIDA";
  if (inactividad >= limites.vencimientoEnMs) return "VENCIDA";
  if (inactividad >= limites.avisoEnMs) return "POR_VENCER";
  return "VIGENTE";
}
