/**
 * Consultas sobre los administradores de plataforma que necesitan los casos de uso del alta y del
 * reenvío (un administrador de plataforma no puede ser gerente de una empresa, decisión F5). Se lee
 * dentro de la transacción del caso de uso, con el contexto de plataforma.
 */
export interface AdminsDePlataforma {
  /**
   * ¿Ese email es el de un administrador de plataforma ACTIVO (ADMIN o SOPORTE)? El adaptador recorta y
   * pasa a minúsculas el texto antes de comparar, igual que la base al guardar el email del administrador,
   * así que un email sin normalizar no esquiva el chequeo.
   */
  esEmailDeAdminActivo(email: string): Promise<boolean>;
}
