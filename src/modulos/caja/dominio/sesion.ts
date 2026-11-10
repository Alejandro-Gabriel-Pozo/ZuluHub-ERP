import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { ESTADOS_DE_SESION, type EstadoDeSesion } from "../estados";

/**
 * La sesión de una caja y su ciclo (e3 §3.2): `ABIERTA ⇄ EN_CIERRE` y cualquiera de las dos `→ CERRADA` (se puede cerrar directo desde
 * `ABIERTA`); nada sale de `CERRADA` (no se reabre). Puro: sin reloj ni azar.
 */

/**
 * Las transiciones que permite el dominio. La base impone EXACTAMENTE las mismas (`sesion_caja_validar_cambio`, 0027): una prueba de
 * integración recorre todos los pares y exige que coincidan. Previene que el código y la base se desalineen.
 */
export const TRANSICIONES_DE_SESION: Readonly<Record<EstadoDeSesion, readonly EstadoDeSesion[]>> = {
  ABIERTA: ["EN_CIERRE", "CERRADA"],
  EN_CIERRE: ["ABIERTA", "CERRADA"],
  CERRADA: [],
};

export function transicionDeSesionPermitida(desde: EstadoDeSesion, hacia: EstadoDeSesion): boolean {
  return TRANSICIONES_DE_SESION[desde].includes(hacia);
}

export type ErrorDeEstadoDeSesion = "SESION_CERRADA";

/** Qué hacer al pedir «iniciar el cierre»: iniciarlo, o ya estaba iniciado (repetir no escribe ni audita). */
export function decidirIniciarCierre(
  estado: EstadoDeSesion,
): Resultado<"INICIAR" | "YA_ESTABA", ErrorDeEstadoDeSesion> {
  if (estado === "CERRADA") return err("SESION_CERRADA");
  return ok(estado === "ABIERTA" ? "INICIAR" : "YA_ESTABA");
}

/** Qué hacer al pedir «cancelar el cierre»: volver a abierta, o ya estaba abierta. */
export function decidirCancelarCierre(
  estado: EstadoDeSesion,
): Resultado<"CANCELAR" | "YA_ESTABA", ErrorDeEstadoDeSesion> {
  if (estado === "CERRADA") return err("SESION_CERRADA");
  return ok(estado === "EN_CIERRE" ? "CANCELAR" : "YA_ESTABA");
}

/** Solo una sesión `ABIERTA` admite movimientos nuevos: en cierre se está contando y una cerrada está congelada. */
export function exigirSesionAbierta(
  estado: EstadoDeSesion,
): Resultado<null, "SESION_EN_CIERRE" | "SESION_CERRADA"> {
  if (estado === "ABIERTA") return ok(null);
  return err(estado === "EN_CIERRE" ? "SESION_EN_CIERRE" : "SESION_CERRADA");
}

export type EstadoDeCaja = "SIN_SESION" | "ABIERTA" | "EN_CIERRE";

/**
 * Cómo está una caja según su sesión no cerrada (`null` o una cerrada: no hay sesión vigente). Es lo que muestra
 * `estadoDeCajasParaCobrar` (e3 §3.5, decisión 145).
 */
export function estadoDeCaja(sesionVigente: EstadoDeSesion | null): EstadoDeCaja {
  if (sesionVigente === "ABIERTA" || sesionVigente === "EN_CIERRE") return sesionVigente;
  return "SIN_SESION";
}

/** Lo que devuelve `registrarCobroEnTx` si la caja no está abierta (e3 §3.5): no hay sesión, o se está contando. */
export function exigirCajaAbiertaParaCobrar(
  sesionVigente: EstadoDeSesion | null,
): Resultado<null, "SIN_SESION_ABIERTA" | "CAJA_EN_CIERRE"> {
  const estado = estadoDeCaja(sesionVigente);
  if (estado === "ABIERTA") return ok(null);
  return err(estado === "EN_CIERRE" ? "CAJA_EN_CIERRE" : "SIN_SESION_ABIERTA");
}

export { ESTADOS_DE_SESION, type EstadoDeSesion };
