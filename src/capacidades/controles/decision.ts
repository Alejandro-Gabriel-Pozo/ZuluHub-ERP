import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { NivelDeControl } from "./nivel";

/**
 * Qué hace un caso de uso cuando la condición de un control SE CUMPLE (si no se cumple, no hay nada que
 * decidir ni registrar). Puro y síncrono; el nivel ya viene resuelto (`resolverNivel` / `NivelesDeControl`).
 *
 *  - `PERMITIR`: sigue, y queda la excepción registrada en la auditoría, en la misma transacción.
 *  - `AVISAR`: sigue solo si la persona confirmó ese control (`confirmaciones`); si no,
 *    `CONTROL_REQUIERE_CONFIRMACION { control }`. La excepción queda registrada con la confirmación.
 *  - `BLOQUEAR`: `CONTROL_BLOQUEA { control }`, aunque venga la confirmación (confirmar no desbloquea).
 */
export type ErrorDeControl<C extends string> =
  | Readonly<{ codigo: "CONTROL_BLOQUEA"; control: C }>
  | Readonly<{ codigo: "CONTROL_REQUIERE_CONFIRMACION"; control: C }>;

/** El control se saltó con permiso: lo que hay que dejar en la auditoría. */
export type ExcepcionDeControl<C extends string> = Readonly<{
  control: C;
  /** El nivel vigente cuando pasó (nunca `BLOQUEAR`: bloqueado no pasa). */
  nivel: Exclude<NivelDeControl, "BLOQUEAR">;
  /** Si la persona había confirmado este control (con `PERMITIR` puede venir igual: se registra). */
  confirmado: boolean;
}>;

export function decidirControl<C extends string>(
  control: C,
  nivel: NivelDeControl,
  confirmaciones: readonly C[],
): Resultado<ExcepcionDeControl<C>, ErrorDeControl<C>> {
  if (nivel === "BLOQUEAR") return err({ codigo: "CONTROL_BLOQUEA", control });
  const confirmado = confirmaciones.includes(control);
  if (nivel === "AVISAR" && !confirmado) {
    return err({ codigo: "CONTROL_REQUIERE_CONFIRMACION", control });
  }
  return ok({ control, nivel, confirmado });
}

/** El documento sobre el que se evaluó el control: su tipo (la `entidad` de la auditoría) y su id. */
export type DocumentoDeControl = Readonly<{ entidad: string; entidadId: string }>;

/**
 * La parte del registro de auditoría que describe el control (el caso de uso le suma `empresaId` y
 * `actorPersonaId`, y lo escribe con `Auditoria.registrar` en la MISMA transacción). Un solo formato
 * para todos los módulos: quién (el actor del registro), cuándo (la fecha de la auditoría), cuál control,
 * sobre qué documento, qué nivel regía y si la persona aceptó el aviso. La confirmación se guarda como
 * `avisoAceptado` y no como «confirmado»: la auditoría rechaza por nombre lo que parece un secreto
 * («firma», «clave», «token», «hash») y «con-firma-do» contiene «firma».
 */
export type RegistroDeControl = Readonly<{
  accion: "CONTROL_EXCEPCION" | "CONTROL_BLOQUEADO";
  entidad: string;
  entidadId: string;
  despues: Readonly<{ control: string; nivel: NivelDeControl; avisoAceptado: boolean }>;
}>;

export function registroDeExcepcion<C extends string>(
  excepcion: ExcepcionDeControl<C>,
  documento: DocumentoDeControl,
): RegistroDeControl {
  return {
    accion: "CONTROL_EXCEPCION",
    entidad: documento.entidad,
    entidadId: documento.entidadId,
    despues: {
      control: excepcion.control,
      nivel: excepcion.nivel,
      avisoAceptado: excepcion.confirmado,
    },
  };
}

/**
 * El intento que un control en `BLOQUEAR` frenó. La operación se rechaza y su transacción se revierte,
 * así que este registro NO puede ir en ella: el caso de uso lo escribe en una transacción propia después
 * del rechazo (la operación frenada no dejó ningún otro efecto).
 */
export function registroDeIntentoBloqueado<C extends string>(
  error: Extract<ErrorDeControl<C>, { codigo: "CONTROL_BLOQUEA" }>,
  documento: DocumentoDeControl,
): RegistroDeControl {
  return {
    accion: "CONTROL_BLOQUEADO",
    entidad: documento.entidad,
    entidadId: documento.entidadId,
    despues: { control: error.control, nivel: "BLOQUEAR", avisoAceptado: false },
  };
}
