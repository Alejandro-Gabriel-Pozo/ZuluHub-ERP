import "server-only";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import { sucursalesDeLaEmpresa } from "../../../src/composicion/sesion-y-empresa";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import {
  fichaDeInvitacion,
  fichaDeUsuario,
  invitar,
  listarUsuarios,
  reenviar,
  revocar,
  type DependenciasDeUsuariosWeb,
  type InvitacionParaLaFicha,
  type ListaDeUsuariosParaLaPantalla,
  type UsuarioParaLaPantalla,
} from "../../../src/composicion/usuarios-web";
import {
  RUTAS_DE_CUENTA,
  rutaDeLaFichaDeInvitacion,
} from "../ui/plantillas/sesion/rutas-de-cuenta";
import type {
  ResultadoDeAccionDeInvitacion,
  ResultadoDeInvitar,
} from "../ui/plantillas/usuarios/resultado-de-usuarios";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { dependenciasDeSesion } from "./sesion";

/**
 * La pantalla «Usuarios» de /cuenta: la lista y la ficha (tramo U1, solo lectura) y, desde el tramo U2, invitar, reenviar y revocar. Finas a propósito (ADR-015, punto 2): reciben el contexto que ya resolvió la página (la
 * empresa y la persona salen de la SESIÓN, nunca de la dirección ni de un formulario) y llaman a `src/composicion/usuarios-web.ts`, donde se prueba el resto. El permiso
 * (`usuarios.ver`) lo decide el servidor dentro de la consulta: la pantalla no valida nada. De la dirección solo se toma el id de la persona de la ficha, y el servidor lo busca
 * entre las personas de LA empresa de la sesión.
 * Previene: ver a las personas de otra empresa porque lo dijo la dirección. Chequeo: `test/integracion/usuarios-web.test.ts`.
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

/** Una invitación pendiente de la empresa, por el id de la dirección (que se valida de nuevo en la composición). */
export function cargarLaFichaDeInvitacion(
  contexto: ContextoOperativo,
  invitacionId: string,
): Promise<Respuesta<InvitacionParaLaFicha>> {
  return fichaDeInvitacion(dependencias, contexto, { invitacionId });
}

/** Las sucursales activas de la empresa de la sesión, para el formulario de invitar y para nombrar las de una invitación (`sucursales.ver`: gerente y administrador). */
export function cargarLasSucursalesParaInvitar(contexto: ContextoOperativo) {
  return sucursalesDeLaEmpresa(dependenciasDeSesion, contexto);
}

/** Lo que se toma de un campo de formulario: un texto, o `undefined` si no vino o no es texto (la composición lo rechaza). */
const textoDe = (datos: FormData, nombre: string): string | undefined => {
  const valor = datos.get(nombre);
  return typeof valor === "string" ? valor : undefined;
};

/** Los textos de un campo repetido (las casillas de sucursales); lo que no es texto (un archivo) se descarta. */
const textosDe = (datos: FormData, nombre: string): string[] =>
  datos.getAll(nombre).filter((v): v is string => typeof v === "string");

/**
 * Invitar por mail. Del formulario solo se toman el email, el rol y las sucursales (lista blanca, campo por campo, en la composición): la empresa y la persona que invita salen de la sesión.
 * Repetir (doble toque, dos pestañas) devuelve la misma invitación y la pantalla lo dice («Ya había una invitación pendiente…»): ni una segunda fila ni otro mail.
 */
export async function invitarAUnUsuario(datos: FormData): Promise<ResultadoDeInvitar> {
  const respuesta = await conLaEmpresa((contexto) =>
    invitar(dependencias, contexto, {
      email: textoDe(datos, "email"),
      rol: textoDe(datos, "rol"),
      sucursales: textosDe(datos, "sucursales"),
    }),
  );
  if (!respuesta.ok) {
    // Con otra invitación vigente de otro rol el servidor no hace pasar por hecho lo pedido, pero a la persona se le dice lo mismo que cuando es del mismo rol: ya había una.
    return respuesta.error.codigo === "USUARIOS_YA_HABIA_INVITACION"
      ? { estado: "YA_HABIA" }
      : { estado: "ERROR", error: respuesta.error };
  }
  return respuesta.dato.yaExistia ? { estado: "YA_HABIA" } : { estado: "HECHO" };
}

/**
 * Reenviar una invitación (el id viene ligado con `.bind` en la acción, no del formulario). Después va a la ficha de la invitación NUEVA.
 * Ninguna de las tres acciones llama a `revalidatePath`: la pantalla navega con una carga completa (`window.location.assign`) a páginas dinámicas, que leen de nuevo; revalidar acá
 * volvería a dibujar la ficha de la invitación YA reenviada o revocada (da el genérico) y desmontaría el botón antes de navegar. Chequeo: `test/recorrido/usuarios-invitar.recorrido.ts` (R3 y R4).
 */
export async function reenviarUnaInvitacion(
  invitacionId: string,
): Promise<ResultadoDeAccionDeInvitacion> {
  const respuesta = await conLaEmpresa((contexto) =>
    reenviar(dependencias, contexto, { invitacionId }),
  );
  if (!respuesta.ok) return { estado: "ERROR", error: respuesta.error };
  return { estado: "HECHO", ruta: rutaDeLaFichaDeInvitacion(respuesta.dato.invitacionId) };
}

/** Revocar una invitación (id ligado con `.bind`). Después vuelve a la lista. */
export async function revocarUnaInvitacion(
  invitacionId: string,
): Promise<ResultadoDeAccionDeInvitacion> {
  const respuesta = await conLaEmpresa((contexto) =>
    revocar(dependencias, contexto, { invitacionId }),
  );
  if (!respuesta.ok) return { estado: "ERROR", error: respuesta.error };
  return { estado: "HECHO", ruta: RUTAS_DE_CUENTA.usuarios };
}

export type { InvitacionParaLaFicha, ListaDeUsuariosParaLaPantalla, UsuarioParaLaPantalla };
