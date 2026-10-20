import type { UsuarioAuthId } from "../primitivas/identificadores/marca";

/**
 * Revocar las sesiones de un usuario de la librería de ingreso (h5-p8 §2.5). Lo cumple el adaptador de Postgres con el
 * rol `pedernal_autenticacion`, el único con `DELETE` sobre `session`. Tipo puro: ni la librería ni la herramienta de
 * datos aparecen acá.
 *
 * La revocación es INMEDIATA para quien presente la cookie: la librería lee la sesión de la base en cada pedido (la
 * caché de cookie está apagada), así que sin la fila no hay sesión, en cualquier host y de cualquier audiencia (empresa
 * o consola: comparten la cuenta de Google y la tabla).
 */
export interface RevocacionDeSesiones {
  /**
   * Borra TODAS las sesiones del usuario y devuelve cuántas borró (0 si no tenía: no es un error). Idempotente:
   * repetirlo no falla ni toca nada más. No toca al usuario, su cuenta ni su segundo factor.
   */
  revocarDelUsuario(usuario: UsuarioAuthId): Promise<number>;
}
