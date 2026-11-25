import "server-only";
import { revalidatePath } from "next/cache";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import { sucursalesDeLaEmpresa } from "../../../src/composicion/sesion-y-empresa";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import {
  asignarSucursalesDeUsuario,
  editorDeSucursalesDeUsuario,
  fichaDeInvitacion,
  fichaDeUsuario,
  invitar,
  listarUsuarios,
  reenviar,
  revocar,
  type DependenciasDeSucursalesDeUsuarioWeb,
  type DependenciasDeUsuariosWeb,
  type InvitacionEmitida,
  type InvitacionParaLaFicha,
  type ListaDeUsuariosParaLaPantalla,
  type OpcionDeSucursalParaLaPantalla,
  type UsuarioParaLaPantalla,
} from "../../../src/composicion/usuarios-web";
import {
  desactivarUsuario,
  reactivarUsuario,
} from "../../../src/composicion/usuarios-desactivar-y-reactivar-web";
import {
  RUTAS_DE_CUENTA,
  rutaDeLaFichaDeInvitacion,
  rutaDeLaFichaDeUsuario,
} from "../ui/plantillas/sesion/rutas-de-cuenta";
import type {
  ResultadoDeAccionDeInvitacion,
  ResultadoDeInvitar,
} from "../ui/plantillas/usuarios/resultado-de-usuarios";
import type { ResultadoDeAccion } from "./acciones";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { despacharElEnvioDeUnaInvitacion } from "./despacho-inmediato";
import { puedeLaAccion } from "./permisos-de-la-persona";
import { dependenciasDeSesion } from "./sesion";

/**
 * La pantalla «Usuarios» de /cuenta: la lista y la ficha (tramo U1, solo lectura), invitar, reenviar y revocar (tramo U2) y desactivar (tramo U3). Finas a propósito (ADR-015, punto 2): reciben el contexto que ya resolvió la página (la
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
  const respuesta = await conLaEmpresa(async (contexto) =>
    conEnvioInmediato(
      contexto,
      await invitar(dependencias, contexto, {
        email: textoDe(datos, "email"),
        rol: textoDe(datos, "rol"),
        sucursales: textosDe(datos, "sucursales"),
      }),
    ),
  );
  return aResultadoDeInvitar(respuesta);
}

/**
 * Pide el envío inmediato del mail de la invitación que quedó (la nueva o, en un doble toque, la que ya había: despachar de nuevo es seguro y levanta un envío que no salió). Recién cuando la
 * acción terminó bien, es decir con la transacción ya confirmada. No cambia lo que ve la persona.
 */
function conEnvioInmediato<D extends Readonly<{ invitacionId: string }>>(
  contexto: ContextoOperativo,
  respuesta: Respuesta<D>,
): Respuesta<D> {
  if (respuesta.ok)
    despacharElEnvioDeUnaInvitacion(contexto.empresaId, respuesta.dato.invitacionId);
  return respuesta;
}

/** De la respuesta de invitar o de reactivar a lo que dibuja el formulario. */
function aResultadoDeInvitar(respuesta: Respuesta<InvitacionEmitida>): ResultadoDeInvitar {
  if (!respuesta.ok) {
    // Con otra invitación vigente de otro rol el servidor no hace pasar por hecho lo pedido, pero a la persona se le dice lo mismo que cuando es del mismo rol: ya había una.
    return respuesta.error.codigo === "USUARIOS_YA_HABIA_INVITACION"
      ? { estado: "YA_HABIA" }
      : { estado: "ERROR", error: respuesta.error };
  }
  return respuesta.dato.yaExistia ? { estado: "YA_HABIA" } : { estado: "HECHO" };
}

/**
 * Reactivar a una persona desactivada (tramo U3, parte B): una invitación nueva con el MISMO rol. El id de la persona viene ligado con `.bind` en la acción (Next lo cifra); del formulario solo se toman las
 * sucursales tildadas. El email y el rol NO viajan: los toma el servidor de la membresía de esa persona. Repetir (doble toque, dos pestañas) devuelve la misma invitación: ni una segunda fila ni otro mail.
 * Como invitar, no llama a `revalidatePath`: el formulario navega con una carga completa a la lista, que lee de nuevo.
 */
export async function reactivarAUnUsuario(
  personaId: string,
  datos: unknown,
): Promise<ResultadoDeInvitar> {
  const respuesta = await conLaEmpresa(async (contexto) =>
    conEnvioInmediato(
      contexto,
      await reactivarUsuario(dependencias, contexto, {
        personaId,
        // Un pedido que no es un formulario no es «ninguna tildada»: se manda sin forma y el servidor lo rechaza.
        sucursales: datos instanceof FormData ? textosDe(datos, "sucursales") : undefined,
      }),
    ),
  );
  return aResultadoDeInvitar(respuesta);
}

/**
 * Reenviar una invitación (el id viene ligado con `.bind` en la acción, no del formulario). Después va a la ficha de la invitación NUEVA.
 * Ninguna de las tres acciones llama a `revalidatePath`: la pantalla navega con una carga completa (`window.location.assign`) a páginas dinámicas, que leen de nuevo; revalidar acá
 * volvería a dibujar la ficha de la invitación YA reenviada o revocada (da el genérico) y desmontaría el botón antes de navegar. Chequeo: `test/recorrido/usuarios-invitar.recorrido.ts` (R3 y R4).
 */
export async function reenviarUnaInvitacion(
  invitacionId: string,
): Promise<ResultadoDeAccionDeInvitacion> {
  const respuesta = await conLaEmpresa(async (contexto) =>
    conEnvioInmediato(contexto, await reenviar(dependencias, contexto, { invitacionId })),
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

/** Desactiva a la persona de la ficha; devuelve el error ya traducido o `{ error: null }`. Vuelve a pedir la lista y la ficha en cualquier caso. */
export async function desactivarElUsuario(personaId: string): Promise<ResultadoDeAccion> {
  const respuesta = await conLaEmpresa((contexto) =>
    desactivarUsuario(dependencias, contexto, { personaId }),
  );
  revalidatePath(RUTAS_DE_CUENTA.usuarios);
  revalidatePath(rutaDeLaFichaDeUsuario(personaId));
  return respuesta.ok ? { error: null } : { error: respuesta.error };
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

export type { InvitacionParaLaFicha, ListaDeUsuariosParaLaPantalla, UsuarioParaLaPantalla };
