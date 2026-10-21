import type { EstadoDeSesionDePlataforma } from "../../../src/capacidades/autenticacion/estado-de-sesion-de-plataforma";

/**
 * Cuándo avisar que la sesión de la consola está por vencer (h5-p8 §3). Puro: el estado lo trae el servidor
 * (`GET /api/auth/estado-de-sesion`, que no renueva) y acá solo se decide qué mostrar.
 *
 *  - Por inactividad: el aviso aparece a los 25 minutos sin uso, cuando quedan 5. «Seguir» renueva.
 *  - Por el tope de 8 horas: aparece 10 minutos antes y NO se puede renovar; la persona termina lo que hace y
 *    vuelve a ingresar (ASUMIDO en P8).
 */

const CINCO_MINUTOS_MS = 5 * 60 * 1000;
const DIEZ_MINUTOS_MS = 10 * 60 * 1000;

export type AvisoDeSesion =
  "ninguno" | "por-vencer-renovable" | "por-vencer-sin-renovar" | "vencida";

export function avisoDeSesion(estado: EstadoDeSesionDePlataforma): AvisoDeSesion {
  if (!estado.vigente || estado.venceEnMs <= 0) return "vencida";
  if (estado.motivo === "TOPE_DE_8_HORAS") {
    return estado.venceEnMs <= DIEZ_MINUTOS_MS ? "por-vencer-sin-renovar" : "ninguno";
  }
  return estado.venceEnMs <= CINCO_MINUTOS_MS ? "por-vencer-renovable" : "ninguno";
}
