import "server-only";
import { revalidatePath } from "next/cache";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  accionesParaElegir,
  archivar,
  asignar,
  crear,
  editar,
  fichaDeRol,
  listarLosRoles,
  rolesAsignables,
  type DependenciasDeRolesWeb,
  type RolParaLaPantalla,
} from "../../../src/composicion/roles-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import type { ModuloParaElegir, RolesAsignables } from "../../../src/modulos/identidad/publico";
import {
  RUTAS_DE_CUENTA,
  rutaDeLaFichaDeRol,
  rutaDeLaFichaDeUsuario,
} from "../ui/plantillas/sesion/rutas-de-cuenta";
import type { ResultadoDeAccion } from "./acciones";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { ofertaDe, permisosDeLaPersona } from "./permisos-de-la-persona";
import { dependenciasDeSesion } from "./sesion";

/**
 * La pantalla «Roles» de /cuenta: lista, ficha, alta, guardar, archivar y reactivar. Finas a propósito (ADR-015, punto 2): reciben el contexto que ya resolvió la página (la empresa y la persona salen de la SESIÓN,
 * nunca de la dirección ni de un formulario) y llaman a `src/composicion/roles-web.ts`, donde se prueba el resto. El permiso lo decide el servidor dentro de la consulta o del caso de uso (solo el gerente): la
 * pantalla no valida nada. De la dirección solo se toma el id del rol, y el servidor lo busca entre los roles de LA empresa de la sesión.
 * Cómo se repite cada acción sin duplicar: crear lleva el id que generó la pantalla (el mismo id devuelve el mismo rol); guardar con la misma edición no escribe; archivar y reactivar lo ya hecho no escriben ni auditan.
 * Todas vuelven a pedir la lista y la ficha, con éxito o sin él: lo que se ve es lo que quedó, aunque otra persona se haya adelantado.
 * Chequeo: `test/integracion/roles-web.test.ts`.
 */

const dependencias: DependenciasDeRolesWeb = {
  casosDeUso: web.casosDeUsoDeIdentidad,
  consultas: web.consultasDeIdentidad,
  respuesta: dependenciasDeSesion.respuesta,
};

/** Los roles propios de la empresa. */
export function cargarLosRoles(
  contexto: ContextoOperativo,
): Promise<Respuesta<readonly RolParaLaPantalla[]>> {
  return listarLosRoles(dependencias, contexto);
}

/** Un rol propio, por el id de la dirección (que se valida de nuevo en la composición). */
export function cargarLaFichaDeRol(
  contexto: ContextoOperativo,
  rolId: string,
): Promise<Respuesta<RolParaLaPantalla>> {
  return fichaDeRol(dependencias, contexto, { rolId });
}

/** Las casillas de la ficha: el catálogo por módulo con pisos y plan. */
export function cargarLasAccionesParaElegir(
  contexto: ContextoOperativo,
): Promise<Respuesta<readonly ModuloParaElegir[]>> {
  return accionesParaElegir(dependencias, contexto);
}

/** Los roles que se pueden asignar (los dos base y los propios activos): para el selector de la ficha de una persona. Solo el gerente (`usuarios.asignar_rol`). */
export function cargarLosRolesAsignables(
  contexto: ContextoOperativo,
): Promise<Respuesta<RolesAsignables>> {
  return rolesAsignables(dependencias, contexto);
}

/**
 * ¿La persona puede crear o editar roles? Es la oferta de `roles.crear` y `roles.editar` (solo el gerente) que el servidor calcula con `ofertaDe`. Si no se pudieron leer los permisos, `false` (cierra, no abre).
 * Ocultar no es autorizar: cada acción vuelve a pasar por el guard dentro de su transacción.
 */
export async function ofertasDeRoles(
  contexto: ContextoOperativo,
): Promise<Readonly<{ crear: boolean; editar: boolean; asignar: boolean }>> {
  const permisos = await permisosDeLaPersona(contexto);
  if (permisos === null) return { crear: false, editar: false, asignar: false };
  return {
    crear: ofertaDe("roles.crear", permisos).permitida,
    editar: ofertaDe("roles.editar", permisos).permitida,
    asignar: ofertaDe("usuarios.asignar_rol", permisos).permitida,
  };
}

/** Lo que se toma de un campo de formulario: un texto, o `undefined` si no vino o no es texto (la composición lo rechaza). */
const textoDe = (datos: FormData, nombre: string): string | undefined => {
  const valor = datos.get(nombre);
  return typeof valor === "string" ? valor : undefined;
};

/** De lo elegido en «Empezar desde» al origen que pide el caso de uso; lo que no es una de las formas conocidas se manda sin forma y el servidor lo rechaza. */
function origenDe(datos: FormData): unknown {
  const origen = textoDe(datos, "origen");
  if (origen === "VACIO") return { tipo: "VACIO" };
  if (origen === "ROL") return { tipo: "ROL", rolId: textoDe(datos, "rolDeOrigen") };
  if (origen?.startsWith("PLANTILLA:") === true) {
    return { tipo: "PLANTILLA", clave: origen.slice("PLANTILLA:".length) };
  }
  return undefined;
}

/**
 * Crear un rol. El id lo genera la página al abrir el formulario y llega ligado con `.bind` (Next lo cifra): es la clave de idempotencia. Del formulario solo se toman el nombre y el origen. Devuelve el id del
 * rol que quedó (el nuevo o, en un doble toque, el que ya había) para ir a su ficha, o el error ya traducido.
 */
export async function crearUnRol(
  rolId: string,
  datos: unknown,
): Promise<Readonly<{ error: ResultadoDeAccion["error"]; rolId: string | null }>> {
  if (!(datos instanceof FormData)) {
    const r = await conLaEmpresa((contexto) => crear(dependencias, contexto, {}));
    return { error: r.ok ? null : r.error, rolId: null };
  }
  const respuesta = await conLaEmpresa((contexto) =>
    crear(dependencias, contexto, {
      rolId,
      nombre: textoDe(datos, "nombre"),
      origen: origenDe(datos),
    }),
  );
  if (!respuesta.ok) return { error: respuesta.error, rolId: null };
  revalidatePath(RUTAS_DE_CUENTA.roles);
  return { error: null, rolId: respuesta.dato.rolId };
}

/**
 * Guardar la ficha de un rol: el nombre y, solo si el formulario dice que cambió (`conjunto=1`), el conjunto FINAL de acciones. El id y la versión que se vio vienen ligados con `.bind`. Sin importar el resultado
 * se vuelve a pedir la ficha: muestra lo guardado, o lo que otra persona dejó si hubo conflicto.
 */
export async function guardarUnRol(
  rolId: string,
  versionEsperada: number,
  datos: unknown,
): Promise<ResultadoDeAccion> {
  const formulario = datos instanceof FormData ? datos : null;
  const respuesta = await conLaEmpresa((contexto) =>
    editar(dependencias, contexto, {
      rolId,
      versionEsperada,
      nombre: formulario === null ? undefined : textoDe(formulario, "nombre"),
      acciones:
        formulario?.get("conjunto") === "1"
          ? formulario.getAll("acciones").filter((v): v is string => typeof v === "string")
          : undefined,
    }),
  );
  revalidatePath(RUTAS_DE_CUENTA.roles);
  revalidatePath(rutaDeLaFichaDeRol(rolId));
  return respuesta.ok ? { error: null } : { error: respuesta.error };
}

/** Archiva el rol de la ficha (id ligado con `.bind`); el servidor lo rechaza si tiene personas. Vuelve a pedir la lista y la ficha en cualquier caso. */
export async function archivarUnRol(rolId: string): Promise<ResultadoDeAccion> {
  const respuesta = await conLaEmpresa((contexto) => archivar(dependencias, contexto, { rolId }));
  revalidatePath(RUTAS_DE_CUENTA.roles);
  revalidatePath(rutaDeLaFichaDeRol(rolId));
  return respuesta.ok ? { error: null } : { error: respuesta.error };
}

/** Reactiva un rol archivado: una edición con `reactivar` (cuenta contra el límite del plan igual que un alta). El id viene ligado con `.bind`. */
export async function reactivarUnRol(rolId: string): Promise<ResultadoDeAccion> {
  const respuesta = await conLaEmpresa((contexto) =>
    editar(dependencias, contexto, { rolId, reactivar: true }),
  );
  revalidatePath(RUTAS_DE_CUENTA.roles);
  revalidatePath(rutaDeLaFichaDeRol(rolId));
  return respuesta.ok ? { error: null } : { error: respuesta.error };
}

/** De lo elegido en el selector del rol (`BASE:<rol>` o `PROPIO:<id>`) al destino que pide el caso de uso; lo que no es una de las dos formas se manda sin forma y el servidor lo rechaza. */
function destinoDe(datos: FormData): unknown {
  const elegido = textoDe(datos, "rol");
  if (elegido?.startsWith("BASE:") === true)
    return { tipo: "BASE", rol: elegido.slice("BASE:".length) };
  if (elegido?.startsWith("PROPIO:") === true) {
    return { tipo: "PROPIO", rolId: elegido.slice("PROPIO:".length) };
  }
  return undefined;
}

/**
 * Asignar un rol a la persona de la ficha (`usuarios.asignar_rol`, solo el gerente). La persona viene ligada con `.bind` (Next la cifra): del formulario solo se toma el rol elegido. Repetirlo no duplica ni audita (el mismo
 * rol no escribe). Sin importar el resultado se vuelve a pedir la ficha y la lista: muestra lo que quedó, o lo que otra persona dejó.
 */
export async function asignarUnRol(personaId: string, datos: unknown): Promise<ResultadoDeAccion> {
  const respuesta = await conLaEmpresa((contexto) =>
    asignar(dependencias, contexto, {
      personaId,
      destino: datos instanceof FormData ? destinoDe(datos) : undefined,
    }),
  );
  revalidatePath(RUTAS_DE_CUENTA.usuarios);
  revalidatePath(rutaDeLaFichaDeUsuario(personaId));
  return respuesta.ok ? { error: null } : { error: respuesta.error };
}

export type { RolParaLaPantalla };
