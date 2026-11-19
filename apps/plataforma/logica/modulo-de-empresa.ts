/**
 * Qué se ofrece en la fila de un módulo de «Plan de una empresa». Puro. Es la única regla de «qué se ofrece»: es una
 * ayuda para la pantalla; el servidor decide todo otra vez al activar o desactivar.
 */
export type AccionDelModulo = "ACTIVAR" | "DESACTIVAR";

export type FilaParaLaAccion = Readonly<{
  obligatorio: boolean;
  /** `false`: el módulo todavía está en desarrollo. */
  disponible: boolean;
  habilitadoPorElPlan: boolean;
  /** Tiene fila activa en la empresa (en uso o en solo lectura por una baja de plan). */
  activado: boolean;
}>;

export function accionDelModulo(modulo: FilaParaLaAccion): AccionDelModulo | null {
  if (modulo.obligatorio) return null;
  if (!modulo.disponible) return null;
  if (modulo.activado) return "DESACTIVAR";
  return modulo.habilitadoPorElPlan ? "ACTIVAR" : null;
}
