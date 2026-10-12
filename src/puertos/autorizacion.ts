import type { RolDeEmpresa } from "../capacidades/permisos/roles";
import type { ContextoOperativo } from "../contexto/contexto";

/**
 * Lo que el guard necesita saber de quien actúa. Los permisos NO se guardan en la sesión ni en
 * ninguna caché: se leen dentro de la transacción de cada caso de uso, así que una baja o una
 * suspensión corta el acceso en la operación siguiente.
 */
export type DatosDelActor = Readonly<{
  /** `null`: sin persona, sin membresía activa en la empresa del contexto o persona suspendida. */
  rol: RolDeEmpresa | null;
  /** Módulos activables que la empresa activó (los obligatorios no se guardan). */
  modulosActivados: readonly string[];
  /**
   * Módulos que el plan de su tenant incluye (el techo), leídos en la misma lectura que el rol.
   * Obligatorio a propósito: una carga que se olvida del plan no compila. Un módulo activado que no
   * figura acá queda en solo lectura (corrección 16).
   */
  modulosHabilitados: readonly string[];
}>;

/**
 * Puerto de carga de datos de autorización. Solo el contexto OPERATIVO tiene actor y empresa: pasarle
 * uno de plataforma, de grupo, de trabajos o de invitación no compila.
 */
export interface CargaDeAutorizacion {
  /**
   * Dentro de la transacción en curso: el rol de la membresía ACTIVA del actor en la empresa del
   * contexto, con la persona activa globalmente (una suspensión de plataforma quita todos los
   * permisos). La membresía de otra empresa no cuenta.
   */
  delActor(contexto: ContextoOperativo): Promise<DatosDelActor>;
}
