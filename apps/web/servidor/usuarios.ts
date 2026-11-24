import "server-only";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import {
  fichaDeUsuario,
  listarUsuarios,
  type DependenciasDeUsuariosWeb,
  type ListaDeUsuariosParaLaPantalla,
  type UsuarioParaLaPantalla,
} from "../../../src/composicion/usuarios-web";
import { web } from "./composicion";
import { dependenciasDeSesion } from "./sesion";

/**
 * La pantalla «Usuarios» de /cuenta (tramo U1, solo lectura): la lista y la ficha. Finas a propósito (ADR-015, punto 2): reciben el contexto que ya resolvió la página (la
 * empresa y la persona salen de la SESIÓN, nunca de la dirección ni de un formulario) y llaman a `src/composicion/usuarios-web.ts`, donde se prueba el resto. El permiso
 * (`usuarios.ver`) lo decide el servidor dentro de la consulta: la pantalla no valida nada. De la dirección solo se toma el id de la persona de la ficha, y el servidor lo busca
 * entre las personas de LA empresa de la sesión.
 * Previene: ver a las personas de otra empresa porque lo dijo la dirección. Chequeo: `test/integracion/usuarios-web.test.ts`.
 */

const dependencias: DependenciasDeUsuariosWeb = {
  consultas: web.consultasDeIdentidad,
  respuesta: dependenciasDeSesion.respuesta,
};

/** Las personas de la empresa y sus invitaciones pendientes. */
export function cargarLaListaDeUsuarios(
  contexto: ContextoOperativo,
): Promise<Respuesta<ListaDeUsuariosParaLaPantalla>> {
  return listarUsuarios(dependencias, contexto);
}

/** Una persona de la empresa, por el id de la dirección (que se valida de nuevo en la composición). */
export function cargarLaFichaDeUsuario(
  contexto: ContextoOperativo,
  personaId: string,
): Promise<Respuesta<UsuarioParaLaPantalla>> {
  return fichaDeUsuario(dependencias, contexto, { personaId });
}

export type { ListaDeUsuariosParaLaPantalla, UsuarioParaLaPantalla };
