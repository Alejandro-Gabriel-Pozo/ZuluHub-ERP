import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import type {
  EventoDelRol,
  ModuloParaElegir,
  RolParaLaLista,
  RolesAsignables,
} from "../modulos/identidad/publico";
import { err, ok, type Resultado } from "../primitivas/resultado/resultado";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import {
  entradaDeAsignarRol,
  entradaDeCrearRol,
  entradaDeEditarRol,
  entradaDeRol,
} from "./entradas-de-roles";
import { accionDeUsuarios, lecturaDeUsuarios } from "./errores-de-usuarios";
import type { Web } from "./web";

/**
 * La pantalla «Roles» de /cuenta (H4b T6): la lista de roles propios, uno por id, las casillas de acciones por módulo, crear, editar (con reactivar) y archivar. Vive acá, y no en `apps/web`, por la misma
 * razón que `usuarios-web.ts`: probarse con la base real sin levantar Next. Misma traducción de errores que Usuarios (`errores-de-usuarios.ts`): todo rechazo de negocio es el genérico y los de la base
 * salen sin detalle y con referencia.
 *
 * Reglas que cumple (cada una con su prueba en `test/integracion/roles-web.test.ts`):
 *  - **La empresa y quien actúa salen de la sesión**; del navegador solo viajan ids de la dirección y los campos del formulario (lista blanca en `entradas-de-roles.ts`). Un rol de otra empresa es
 *    indistinguible de uno inexistente.
 *  - **El permiso es del caso de uso o de la consulta** (`roles.ver`, `roles.crear`, `roles.editar`, `roles.archivar`: solo el gerente); acá no se decide ninguno.
 *  - **Toda escritura es del caso de uso**: transacción serializable, idempotencia, versión esperada, auditoría. Esta capa no agrega reglas.
 *  - **Todo resultado sale por el camino común** (`aRespuesta`, ADR-016).
 */

export type DependenciasDeRolesWeb = Readonly<{
  casosDeUso: () => Pick<
    ReturnType<Web["casosDeUsoDeIdentidad"]>,
    "crearRol" | "editarRol" | "archivarRol" | "asignarRol"
  >;
  consultas: () => Pick<
    ReturnType<Web["consultasDeIdentidad"]>,
    | "listarRoles"
    | "verRol"
    | "historialDelRol"
    | "accionesParaElegir"
    | "rolesAsignables"
    | "personasParaMostrar"
  >;
  respuesta: DependenciasDeRespuesta;
}>;

/** Un rol propio tal como lo dibuja la pantalla (lista y ficha): objeto plano, sin texto de marca. */
export type RolParaLaPantalla = RolParaLaLista;

/** Los roles propios de la empresa (`roles.ver`), activos y archivados, ordenados por nombre. */
export function listarLosRoles(
  d: DependenciasDeRolesWeb,
  contexto: ContextoOperativo,
): Promise<Respuesta<readonly RolParaLaPantalla[]>> {
  return lecturaDeUsuarios(
    d.respuesta,
    () => d.consultas().listarRoles(contexto),
    (roles) => roles,
  );
}

/** Un rol propio por el id de la dirección (`roles.ver`). Uno inexistente o de otra empresa es el genérico, sin decir cuál de las dos cosas pasó. */
export function fichaDeRol(
  d: DependenciasDeRolesWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<RolParaLaPantalla>> {
  return accionDeUsuarios(
    d.respuesta,
    crudo,
    entradaDeRol,
    async (entrada): Promise<Resultado<RolParaLaPantalla, unknown>> => {
      const rol = await d.consultas().verRol(contexto, { rolId: entrada.rolId });
      if (!rol.ok) return rol;
      return rol.valor === null ? err("ROL_NO_ENCONTRADO") : ok(rol.valor);
    },
    (rol) => rol,
  );
}

/** Un cambio en la vida de un rol propio tal como lo dibuja la pantalla: la fecha como instante ISO y quién lo hizo como correo (`null`: actor de sistema). */
export type EventoDelRolParaLaPantalla = Readonly<{
  id: string;
  tipo: EventoDelRol["tipo"];
  cuando: string;
  por: string | null;
  nombreAnterior: string | null;
  nombreNuevo: string | null;
  agregadas: readonly string[];
  quitadas: readonly string[];
}>;

/**
 * El historial de un rol propio por el id de la dirección (`roles.ver`, solo el gerente): los últimos cambios del más nuevo al más viejo, con el correo de quien los hizo (`personasParaMostrar`, una sola vez).
 * Uno inexistente o de otra empresa es el genérico, sin decir cuál de las dos cosas pasó. Solo lectura.
 */
export function historialDelRol(
  d: DependenciasDeRolesWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<readonly EventoDelRolParaLaPantalla[]>> {
  return accionDeUsuarios(
    d.respuesta,
    crudo,
    entradaDeRol,
    async (entrada): Promise<Resultado<readonly EventoDelRolParaLaPantalla[], unknown>> => {
      const historial = await d.consultas().historialDelRol(contexto, { rolId: entrada.rolId });
      if (!historial.ok) return historial;
      if (historial.valor === null) return err("ROL_NO_ENCONTRADO");
      const ids = [
        ...new Set(
          historial.valor.eventos.flatMap((e) => (e.porPersonaId === null ? [] : [e.porPersonaId])),
        ),
      ];
      const personas = await d.consultas().personasParaMostrar(contexto, { ids });
      // No se esconde ningún fallo: sin el correo no hay «quién», y un historial sin quién engaña.
      if (!personas.ok) return personas;
      return ok(
        historial.valor.eventos.map((e) => ({
          id: e.id,
          tipo: e.tipo,
          cuando: e.cuando.toISOString(),
          por: e.porPersonaId === null ? null : (personas.valor.get(e.porPersonaId) ?? null),
          nombreAnterior: e.nombreAnterior,
          nombreNuevo: e.nombreNuevo,
          agregadas: e.agregadas,
          quitadas: e.quitadas,
        })),
      );
    },
    (eventos) => eventos,
  );
}

/** Todo el catálogo por módulo con el piso de cada acción y si el plan incluye el módulo (`roles.ver`). */
export function accionesParaElegir(
  d: DependenciasDeRolesWeb,
  contexto: ContextoOperativo,
): Promise<Respuesta<readonly ModuloParaElegir[]>> {
  return lecturaDeUsuarios(
    d.respuesta,
    () => d.consultas().accionesParaElegir(contexto),
    (modulos) => modulos,
  );
}

/** Lo que devuelve crear: el rol que quedó. `yaExistia: true` NO es un error: el mismo pedido repetido (o un rol activo con ese nombre) no escribe ni audita otra vez. */
export type RolCreado = Readonly<{ rolId: string; yaExistia: boolean }>;

/**
 * Crear un rol propio (`roles.crear`). `crudo`: `{ rolId, nombre, origen }`. El `rolId` lo genera la pantalla al abrir el formulario y es la clave de idempotencia: un doble toque o un reintento de
 * red devuelven el mismo rol, nunca dos.
 */
export function crear(
  d: DependenciasDeRolesWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<RolCreado>> {
  return accionDeUsuarios(
    d.respuesta,
    crudo,
    entradaDeCrearRol,
    (entrada) => d.casosDeUso().crearRol(contexto, entrada),
    (salida) => ({ rolId: salida.rolId, yaExistia: salida.yaExistia }),
  );
}

/** Lo que devuelve editar: si cambió algo y el número de la versión de acciones vigente. */
export type RolEditado = Readonly<{ cambio: boolean; numeroDeVersion: number }>;

/**
 * Editar un rol propio (`roles.editar`): su nombre y/o el conjunto FINAL de acciones; con `reactivar` primero se vuelve a activar uno archivado. `versionEsperada` es la `version` que vio quien edita:
 * si otra persona lo cambió antes, el caso de uso rechaza y la pantalla vuelve a leer. Repetir la misma edición no escribe ni audita.
 */
export function editar(
  d: DependenciasDeRolesWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<RolEditado>> {
  return accionDeUsuarios(
    d.respuesta,
    crudo,
    entradaDeEditarRol,
    (entrada) => d.casosDeUso().editarRol(contexto, entrada),
    (salida) => ({ cambio: salida.cambio, numeroDeVersion: salida.numeroDeVersion }),
  );
}

/** Lo que devuelve archivar. */
export type RolArchivado = Readonly<{ yaEstabaArchivado: boolean }>;

/** Archivar un rol propio (`roles.archivar`): solo si no tiene personas activas. Repetirlo es inocuo (`yaEstabaArchivado`). */
export function archivar(
  d: DependenciasDeRolesWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<RolArchivado>> {
  return accionDeUsuarios(
    d.respuesta,
    crudo,
    entradaDeRol,
    (entrada) => d.casosDeUso().archivarRol(contexto, entrada),
    (salida) => ({ yaEstabaArchivado: salida.yaEstabaArchivado }),
  );
}

/** Los roles que el gerente puede asignar hoy: los dos base y los roles propios ACTIVOS (`usuarios.asignar_rol`). */
export function rolesAsignables(
  d: DependenciasDeRolesWeb,
  contexto: ContextoOperativo,
): Promise<Respuesta<RolesAsignables>> {
  return lecturaDeUsuarios(
    d.respuesta,
    () => d.consultas().rolesAsignables(contexto),
    (r) => r,
  );
}

/** Lo que devuelve asignar: `cambio: false` si la persona ya tenía ese rol (no se escribió ni se auditó nada). */
export type RolAsignado = Readonly<{ cambio: boolean }>;

/**
 * Asignar un rol a una persona de la empresa (`usuarios.asignar_rol`, solo el gerente). `crudo`: `{ personaId, destino }`. Repetirlo es inocuo (el mismo rol no escribe ni audita); al gerente no se lo toca; un rol propio archivado
 * o de otra empresa se rechaza dentro del caso de uso. Rige desde la operación siguiente de esa persona.
 */
export function asignar(
  d: DependenciasDeRolesWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<RolAsignado>> {
  return accionDeUsuarios(
    d.respuesta,
    crudo,
    entradaDeAsignarRol,
    (entrada) => d.casosDeUso().asignarRol(contexto, entrada),
    (salida) => ({ cambio: salida.cambio }),
  );
}
