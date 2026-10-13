import type { UsuarioAuthId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { PersonaConUsuario } from "./membresia";

/**
 * El vínculo entre una persona (negocio) y el usuario autenticado (ingreso): se fija UNA vez, al aceptar
 * una invitación, y no se cambia (la base lo impone con un disparador). Nunca se busca a la persona por
 * email para darle acceso (ADR-013): quien entra con un enlace de invitación queda atado a la persona del
 * email de ESE enlace, y a ninguna otra.
 */
export type DecisionDeVinculo = "VINCULAR" | "YA_VINCULADA";

/**
 * Decide qué hacer con el vínculo de la persona del email de la invitación cuando acepta `usuario`:
 *
 * - Sin persona todavía (se va a crear) o sin usuario vinculado: `VINCULAR`.
 * - Ya vinculada con este mismo usuario: `YA_VINCULADA` (repetir no escribe: idempotente).
 * - Vinculada con otro usuario: `PERSONA_DE_OTRO_USUARIO` (nunca se pisa el vínculo).
 */
export function decidirVinculo(
  persona: PersonaConUsuario | null,
  usuario: UsuarioAuthId,
): Resultado<DecisionDeVinculo, "PERSONA_DE_OTRO_USUARIO"> {
  if (persona === null || persona.usuarioAuth === null) return ok("VINCULAR");
  return persona.usuarioAuth === usuario ? ok("YA_VINCULADA") : err("PERSONA_DE_OTRO_USUARIO");
}
