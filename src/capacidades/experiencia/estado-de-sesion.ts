import { estadoDeInactividad } from "./inactividad";

/** Los tres estados que entiende `AvisoDeSesion` (la interfaz) para cada estado de inactividad. */
export type EstadoDeSesionDePantalla = "activa" | "por-vencer" | "vencida";

const ESTADO_DE_PANTALLA = {
  VIGENTE: "activa",
  POR_VENCER: "por-vencer",
  VENCIDA: "vencida",
} as const satisfies Record<ReturnType<typeof estadoDeInactividad>, EstadoDeSesionDePantalla>;

/**
 * El estado de la sesión en la pantalla según cuántos milisegundos pasaron sin que nadie la use. Usa la MISMA
 * función y los mismos límites (12 y 15 minutos) que el servidor: una sola fuente, así el aviso de la pantalla
 * y el vencimiento real no se desfasan. Previene: un aviso a destiempo o un vencimiento que sorprende.
 * Chequeo: `estado-de-sesion.test.ts`.
 */
export function estadoDeSesionDePantalla(milisegundosSinUso: number): EstadoDeSesionDePantalla {
  // El 0 de referencia es arbitrario: `estadoDeInactividad` solo mira la diferencia entre las dos fechas.
  return ESTADO_DE_PANTALLA[estadoDeInactividad(new Date(0), new Date(milisegundosSinUso))];
}
