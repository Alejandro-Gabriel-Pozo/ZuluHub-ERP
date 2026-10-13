import { createHash, randomUUID } from "node:crypto";
import { usuarioAuthId, type UsuarioAuthId } from "../../src/primitivas/identificadores/marca";

/**
 * Los usuarios autenticados de las PRUEBAS. Un `UsuarioAuthId` es el `user.id` de la librería de
 * autenticación: acá no hay librería, así que se arma uno con forma de uuid. Dos usos:
 *  - `usuarioDePrueba(semilla)`: el MISMO usuario para la misma semilla (por ejemplo, el email): una persona
 *    que acepta dos invitaciones es siempre el mismo usuario, como lo sería en producción.
 *  - `usuarioAlAzar()`: uno distinto cada vez.
 */
export function usuarioDePrueba(semilla: string): UsuarioAuthId {
  const h = createHash("sha256").update(`usuario-de-prueba:${semilla}`).digest("hex");
  return usuarioAuthId(
    `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`,
  );
}

export const usuarioAlAzar = (): UsuarioAuthId => usuarioAuthId(randomUUID());
