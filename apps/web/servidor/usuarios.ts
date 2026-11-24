import "server-only";
import { revalidatePath } from "next/cache";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import {
  desactivarUsuario,
  fichaDeUsuario,
  listarUsuarios,
  type DependenciasDeUsuariosWeb,
  type ListaDeUsuariosParaLaPantalla,
  type UsuarioParaLaPantalla,
} from "../../../src/composicion/usuarios-web";
import { RUTAS_DE_CUENTA, rutaDeLaFichaDeUsuario } from "../ui/plantillas/sesion/rutas-de-cuenta";
import type { ResultadoDeAccion } from "./acciones";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { dependenciasDeSesion } from "./sesion";

/**
 * La pantalla «Usuarios» de /cuenta: la lista y la ficha (tramo U1, solo lectura) y la acción de desactivar (tramo U3). Finas a propósito (ADR-015, punto 2): reciben el contexto que ya resolvió la página (la
 * empresa y la persona salen de la SESIÓN, nunca de la dirección ni de un formulario) y llaman a `src/composicion/usuarios-web.ts`, donde se prueba el resto. El permiso
 * (`usuarios.ver`) lo decide el servidor dentro de la consulta: la pantalla no valida nada. De la dirección solo se toma el id de la persona de la ficha, y el servidor lo busca
 * entre las personas de LA empresa de la sesión.
 * Desactivar resuelve QUIÉN y DÓNDE actúa con `conLaEmpresa` (sesión, origen propio y empresa elegida, nunca lo que diga el navegador) y solo recibe el id de la persona, que la acción liga con `.bind`
 * (Next lo cifra). Repetirla no duplica ni audita dos veces (la segunda es ok sin escribir): por eso no lleva clave. Se queda en la pantalla (no redirige: precedente de Clientes) y SIEMPRE vuelve a pedir
 * la lista y la ficha, con éxito o sin él: lo que se ve es lo que quedó, aunque otra persona se haya adelantado.
 * Previene: ver a las personas de otra empresa porque lo dijo la dirección, y mostrar «Activo» después de que otra persona ya desactivó. Chequeo: `test/integracion/usuarios-web.test.ts`.
 */

const dependencias: DependenciasDeUsuariosWeb = {
  casosDeUso: web.casosDeUsoDeIdentidad,
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

/** Desactiva a la persona de la ficha; devuelve el error ya traducido o `{ error: null }`. Vuelve a pedir la lista y la ficha en cualquier caso. */
export async function desactivarElUsuario(personaId: string): Promise<ResultadoDeAccion> {
  const respuesta = await conLaEmpresa((contexto) =>
    desactivarUsuario(dependencias, contexto, { personaId }),
  );
  revalidatePath(RUTAS_DE_CUENTA.usuarios);
  revalidatePath(rutaDeLaFichaDeUsuario(personaId));
  return respuesta.ok ? { error: null } : { error: respuesta.error };
}

export type { ListaDeUsuariosParaLaPantalla, UsuarioParaLaPantalla };
