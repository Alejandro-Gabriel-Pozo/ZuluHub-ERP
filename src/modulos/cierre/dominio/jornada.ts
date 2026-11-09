import type { EmpresaId, PersonaId, SucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";

/**
 * La jornada de una sucursal y su ciclo (E3b §3.2 y §3.3; decisiones 158, 160 y 168). Una jornada por `(empresa, sucursal, fecha de
 * negocio)`: `ABIERTA → EN_AUDITORIA ⇄ ABIERTA` y `EN_AUDITORIA → CERRADA`; nada sale de `CERRADA`. Los nombres técnicos conservan
 * «auditoría» (decisión 160); en pantalla es «Cierre del día». Puro: sin reloj ni azar.
 */
export const ESTADOS_DE_JORNADA = ["ABIERTA", "EN_AUDITORIA", "CERRADA"] as const;
export type EstadoDeJornada = (typeof ESTADOS_DE_JORNADA)[number];

/** `SIN_ACTIVIDAD`: nadie registró nada ese día, así que la jornada todavía no existe (la crea quien tiene la primera actividad). */
export type EstadoConsultado = EstadoDeJornada | "SIN_ACTIVIDAD";

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
