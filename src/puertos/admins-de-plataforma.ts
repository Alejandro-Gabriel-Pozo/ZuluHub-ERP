import type { AdminPlataformaId } from "../primitivas/identificadores/marca";
import type { RolDeAdministrador } from "./autorizacion-de-plataforma";

/**
 * Consultas sobre los administradores de plataforma que necesitan los casos de uso del alta y del
 * reenvío (un administrador de plataforma no puede ser gerente de una empresa, decisión F5). Se lee
 * dentro de la transacción del caso de uso, con el contexto de plataforma.
 */
/** Un administrador de plataforma tal como lo guarda la base (lo que un script necesita para actuar en su nombre). */
export type AdminEncontrado = Readonly<{
  id: AdminPlataformaId;
  rol: RolDeAdministrador;
  activo: boolean;
}>;

export interface AdminsDePlataforma {
  /**
   * ¿Ese email es el de un administrador de plataforma ACTIVO (ADMIN o SOPORTE)? El adaptador recorta y
   * pasa a minúsculas el texto antes de comparar, igual que la base al guardar el email del administrador,
   * así que un email sin normalizar no esquiva el chequeo.
   */
  esEmailDeAdminActivo(email: string): Promise<boolean>;

  /**
   * El administrador con ese email (activo o no), o `null`. Es para los scripts de la puerta de plataforma,
   * que reciben el email de quien actúa y necesitan su id para firmar el contexto: se llama con el actor
   * `sistema`, porque todavía no se sabe quién es. El adaptador normaliza el email como al guardarlo.
   */
  buscarPorEmail(email: string): Promise<AdminEncontrado | null>;
}
