import type { ContextoDePlataforma } from "../contexto/contexto";

/**
 * Los roles de un administrador de plataforma. Contrato estructural mínimo: la fuente del catálogo y
 * de la matriz de permisos de plataforma es `capacidades/permisos/plataforma.ts` (tramo P1), que este
 * puerto no copia; una prueba de integración compara estos valores con el CHECK de la base
 * (`admin_plataforma_rol_ck`).
 */
export const ROLES_DE_ADMINISTRADOR = ["ADMIN", "SOPORTE"] as const;
export type RolDeAdministrador = (typeof ROLES_DE_ADMINISTRADOR)[number];

/** Lo que el guard de plataforma necesita saber de quien actúa. */
export type DatosDelAdministrador = Readonly<{
  /**
   * `null`: el actor no es un administrador ACTIVO (es `sistema`, el id no existe o fue dado de baja).
   * El guard lo traduce a `SIN_PERMISO`.
   */
  rol: RolDeAdministrador | null;
}>;

/**
 * Puerto de carga de datos de autorización de plataforma. Igual que el de empresa, NO se guarda nada
 * entre llamadas: el rol y el estado `activo` se leen dentro de la transacción de cada caso de uso, así
 * que dar de baja a un administrador corta su acceso en la operación siguiente. Solo el contexto de
 * PLATAFORMA tiene actor: pasarle otro no compila.
 */
export interface CargaDeAutorizacionDePlataforma {
  delActor(contexto: ContextoDePlataforma): Promise<DatosDelAdministrador>;
}
