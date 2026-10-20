import { usuarioAuthId } from "../../../primitivas/identificadores/marca";
import type { ManejadorDeTrabajo } from "../../../puertos/cola-de-trabajos";
import type { RevocacionDeSesiones } from "../../../puertos/revocacion-de-sesiones";

/**
 * Efecto del trabajo `revocar_sesiones` (h5-p8 §2.5; H5 §B.5.6), lo que encola la suspensión de una persona con datos
 * `{ usuarioAuthId }` y la clave `persona:<id>:suspension:<clave>`, en la misma transacción que la suspende.
 *
 * Borra TODAS las sesiones de ese usuario de la librería de ingreso (de empresa y de la consola: comparten la cuenta de
 * Google) con el rol de autenticación, el único que puede. No hace nada más: no toca la persona ni su cuenta.
 *
 * Idempotente: puede ejecutarse más de una vez (reintento, plazo vencido) y no falla si no hay sesiones (la persona
 * nunca abrió una, o ya se la había cerrado): termina `HECHO` y deja en la nota cuántas borró, sin ningún dato del
 * usuario. Un dato que no es un uuid es un trabajo mal encolado: falla DEFINITIVO (reintentar no lo arregla). Un fallo
 * de la base es reintentable.
 *
 * `revocacion` entra como función: la conexión de autenticación se pide recién al ejecutar el trabajo, así que armar
 * el procesador no exige su cadena de conexión.
 */
export type DependenciasDeRevocarSesiones = Readonly<{
  revocacion: () => RevocacionDeSesiones;
}>;

export function crearManejadorDeRevocarSesiones({
  revocacion,
}: DependenciasDeRevocarSesiones): ManejadorDeTrabajo {
  return async (trabajo) => {
    const crudo = trabajo.datos["usuarioAuthId"];
    let usuario;
    try {
      usuario = usuarioAuthId(typeof crudo === "string" ? crudo : "");
    } catch {
      return {
        tipo: "ERROR",
        error: "los datos del trabajo no traen un usuarioAuthId válido",
        definitivo: true,
      };
    }
    const borradas = await revocacion().revocarDelUsuario(usuario);
    return { tipo: "HECHO", nota: `sesiones revocadas: ${borradas}` };
  };
}
