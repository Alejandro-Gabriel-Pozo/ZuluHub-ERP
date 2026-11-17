import type { EmpresaId, PersonaId, SucursalId } from "../../../primitivas/identificadores/marca";
import { ESTADOS_DE_JORNADA, type EstadoConsultado, type EstadoDeJornada } from "../estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";

/**
 * La jornada de una sucursal y su ciclo (E3b §3.2 y §3.3; decisiones 158, 160 y 168). Una jornada por `(empresa, sucursal, fecha de
 * negocio)`: `ABIERTA → EN_AUDITORIA ⇄ ABIERTA` y `EN_AUDITORIA → CERRADA`; nada sale de `CERRADA`. Los nombres técnicos conservan
 * «auditoría» (decisión 160); en pantalla es «Cierre del día». Puro: sin reloj ni azar.
 */

/**
 * Las transiciones que permite el dominio. La base impone EXACTAMENTE las mismas (`jornada_validar_cambio`, 0026): una prueba de
 * integración recorre todos los pares y exige que coincidan. Previene que el código y la base se desalineen.
 */
export const TRANSICIONES_DE_JORNADA: Readonly<
  Record<EstadoDeJornada, readonly EstadoDeJornada[]>
> = {
  ABIERTA: ["EN_AUDITORIA"],
  EN_AUDITORIA: ["ABIERTA", "CERRADA"],
  CERRADA: [],
};

export function transicionPermitida(desde: EstadoDeJornada, hacia: EstadoDeJornada): boolean {
  return TRANSICIONES_DE_JORNADA[desde].includes(hacia);
}

export type Jornada = Readonly<{
  empresaId: EmpresaId;
  sucursalId: SucursalId;
  fechaDeNegocio: FechaCivil;
  estado: EstadoDeJornada;
  auditoriaIniciadaEn: Date | null;
  auditoriaIniciadaPor: PersonaId | null;
  cerradaEn: Date | null;
  cerradaPor: PersonaId | null;
  /** sha256 (hex) de los controles que se vieron al cerrar. */
  huellaDeCierre: string | null;
  observacion: string | null;
  version: number;
}>;

export type ErrorDeEstadoDeJornada = "JORNADA_CERRADA";

/** Qué hacer al pedir «empezar el cierre»: empezarlo, o ya estaba empezado (repetir no escribe ni audita). */
export function decidirIniciar(
  estado: EstadoDeJornada,
): Resultado<"INICIAR" | "YA_ESTABA", ErrorDeEstadoDeJornada> {
  if (estado === "CERRADA") return err("JORNADA_CERRADA");
  return ok(estado === "ABIERTA" ? "INICIAR" : "YA_ESTABA");
}

/** Qué hacer al pedir «cancelar el cierre»: cancelarlo, o ya estaba abierta (repetir no escribe ni audita). */
export function decidirCancelar(
  estado: EstadoDeJornada,
): Resultado<"CANCELAR" | "YA_ESTABA", ErrorDeEstadoDeJornada> {
  if (estado === "CERRADA") return err("JORNADA_CERRADA");
  return ok(estado === "EN_AUDITORIA" ? "CANCELAR" : "YA_ESTABA");
}

/** Por qué no se puede desactivar una sucursal en cuanto a su jornada (decisión 178). Los códigos son tipados: nunca texto en el error. */
export type ErrorDeJornadaAlDesactivar =
  "SUCURSAL_CON_JORNADA_EN_AUDITORIA" | "SUCURSAL_CON_MOVIMIENTO_EN_LA_JORNADA";

/**
 * Qué hacer con la jornada VIGENTE de una sucursal que se quiere desactivar (decisión 178), según su estado:
 *  - sin jornada o ya cerrada: no hay nada abierto, se desactiva sin tocarla;
 *  - `EN_AUDITORIA`: se rechaza (el cierre del día está en curso; se termina o se cancela antes);
 *  - `ABIERTA`: hay que mirar si tiene movimiento (`decidirConMovimiento`).
 */
export function decidirAlDesactivar(
  estado: EstadoConsultado,
): Resultado<"NADA_QUE_CERRAR" | "VER_SI_HAY_MOVIMIENTO", ErrorDeJornadaAlDesactivar> {
  if (estado === "EN_AUDITORIA") return err("SUCURSAL_CON_JORNADA_EN_AUDITORIA");
  return ok(estado === "ABIERTA" ? "VER_SI_HAY_MOVIMIENTO" : "NADA_QUE_CERRAR");
}

/** Una jornada abierta sin movimiento en ningún módulo se cierra sola; con movimiento se pide hacer antes el cierre del día. */
export function decidirConMovimiento(
  hayMovimiento: boolean,
): Resultado<"CERRAR_SOLA", ErrorDeJornadaAlDesactivar> {
  return hayMovimiento ? err("SUCURSAL_CON_MOVIMIENTO_EN_LA_JORNADA") : ok("CERRAR_SOLA");
}

export { ESTADOS_DE_JORNADA, type EstadoConsultado, type EstadoDeJornada };
