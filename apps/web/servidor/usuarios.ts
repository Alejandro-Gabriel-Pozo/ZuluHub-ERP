import "server-only";
import { revalidatePath } from "next/cache";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import {
  asignarSucursalesDeUsuario,
  editorDeSucursalesDeUsuario,
  fichaDeUsuario,
  listarUsuarios,
  type DependenciasDeSucursalesDeUsuarioWeb,
  type DependenciasDeUsuariosWeb,
  type ListaDeUsuariosParaLaPantalla,
  type OpcionDeSucursalParaLaPantalla,
  type UsuarioParaLaPantalla,
} from "../../../src/composicion/usuarios-web";
import { rutaDeLaFichaDeUsuario } from "../ui/plantillas/sesion/rutas-de-cuenta";
import type { ResultadoDeAccion } from "./acciones";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { puedeLaAccion } from "./permisos-de-la-persona";
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

const dependenciasDeSucursales: DependenciasDeSucursalesDeUsuarioWeb = {
  consultas: web.consultasDeIdentidad,
  consultasDeEmpresas: web.consultasDeEmpresas,
  casosDeUso: web.casosDeUsoDeIdentidad,
  respuesta: dependenciasDeSesion.respuesta,
};

/**
 * Las sucursales de la persona de la ficha para el editor (U4): `null` si no es un empleado activo (la ficha no dice nada de sucursales) o si quien mira no puede asignarlas (sin permiso no hay
 * bloque). Las casillas las arma el servidor entre las sucursales ACTIVAS de la empresa de la sesión.
 */
export async function cargarElEditorDeSucursales(
  contexto: ContextoOperativo,
  personaId: string,
): Promise<Respuesta<readonly OpcionDeSucursalParaLaPantalla[] | null>> {
  if (!(await puedeLaAccion(contexto, "usuarios.asignar_sucursales")))
    return { ok: true, dato: null };
  return editorDeSucursalesDeUsuario(dependenciasDeSucursales, contexto, { personaId });
}

/**
 * Guardar las sucursales de un empleado (U4): `datos` trae las casillas tildadas (`sucursales`, una por sucursal); ninguna tildada es el conjunto vacío, válido. La persona viene ligada con `.bind`
 * (Next la cifra) y la empresa y quien actúa salen de la SESIÓN. Sin importar el resultado se vuelve a pedir la ficha: muestra lo guardado, o lo que otra persona dejó si hubo conflicto.
 * Cómo se repite sin duplicar: el mismo conjunto no escribe ni audita (el caso de uso lo resuelve); no lleva clave.
 */
export async function guardarLasSucursalesDeUnEmpleado(
  personaId: string,
  datos: unknown,
): Promise<ResultadoDeAccion> {
  const sucursales = datos instanceof FormData ? datos.getAll("sucursales") : null;
  const respuesta = await conLaEmpresa((contexto) =>
    asignarSucursalesDeUsuario(dependenciasDeSucursales, contexto, {
      personaId,
      // Un pedido que no es un formulario no es «ninguna tildada»: se manda sin forma y el servidor lo rechaza.
      sucursales: sucursales?.filter((valor): valor is string => typeof valor === "string"),
    }),
  );
  revalidatePath(rutaDeLaFichaDeUsuario(personaId));
  return respuesta.ok ? { error: null } : { error: respuesta.error };
}

export type { ListaDeUsuariosParaLaPantalla, UsuarioParaLaPantalla };
