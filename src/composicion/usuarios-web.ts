import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { RolDeEmpresa } from "../capacidades/permisos/roles";
import type { ContextoOperativo } from "../contexto/contexto";
import type { SucursalDeLista } from "../modulos/empresas/publico";
import type { InvitacionPendienteDeLaLista, MiembroDeLista } from "../modulos/identidad/publico";
import type { PersonaId } from "../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../primitivas/resultado/resultado";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import {
  entradaDeAsignarSucursalesDeUsuario,
  entradaDeFichaDeUsuario,
  entradaDeInvitacion,
  entradaDeInvitar,
} from "./entradas-de-usuarios";
import { accionDeUsuarios, lecturaDeUsuarios } from "./errores-de-usuarios";
import type { Web } from "./web";

/**
 * La pantalla «Usuarios» de /cuenta: la lista de quienes tienen acceso a la empresa con sus invitaciones pendientes, la ficha de una persona (tramo U1, solo lectura) y, desde el tramo U2,
 * invitar, reenviar y revocar una invitación.
 * Vive acá, y no en `apps/web`, por la misma razón que `contacto-de-sucursal-web.ts`: probarse con la base real sin levantar Next.
 *
 * Reglas que cumple (cada una con su prueba en `test/integracion/usuarios-web.test.ts`):
 *  - **La empresa y la persona salen de la sesión.** El contexto lo arma el servidor; del navegador solo viaja el id de la persona de la ficha, y el servidor la busca ENTRE LAS DE
 *    LA EMPRESA de la sesión (`listarMiembros` filtra por empresa con las políticas de fila de la base): una persona de otra empresa es indistinguible de una inexistente.
 *  - **El permiso es de la consulta.** Las dos exigen `usuarios.ver` al guard dentro de su transacción (solo gerente y administrador): acá no se decide ningún permiso. Sin él no sale ninguna fila.
 *  - **Nada de más sale.** Lista blanca campo por campo: de un miembro, id, email, rol y si está activo (las sucursales no viajan en este tramo); de una invitación, id, email, rol, vencimiento
 *    y si venció. Nunca el token ni su hash (la consulta ya no los trae) ni quién la emitió.
 *  - **Todo o nada.** Si una de las dos consultas falla, falla la pantalla entera: no hay lista a medias.
 *  - **Todo resultado sale por el camino común** (`aRespuesta`, ADR-016): un rechazo es el genérico y un fallo de la base sale con referencia, sin detalle.
 *  - **Solo lectura.** No escribe ni audita: no hay idempotencia ni concurrencia que cuidar de este lado.
 *
 * El tramo U4 suma abajo las sucursales del empleado (`editorDeSucursalesDeUsuario` y `asignarSucursalesDeUsuario`); sus reglas están en el comentario de esa sección.
 */

export type DependenciasDeUsuariosWeb = Readonly<{
  casosDeUso: () => Pick<
    ReturnType<Web["casosDeUsoDeIdentidad"]>,
    "invitarUsuario" | "reenviarInvitacion" | "revocarInvitacion"
  >;
  consultas: () => Pick<
    ReturnType<Web["consultasDeIdentidad"]>,
    "listarMiembros" | "listarInvitacionesPendientes"
  >;
  respuesta: DependenciasDeRespuesta;
}>;

/** Una persona de la empresa tal como la dibuja la pantalla. */
export type UsuarioParaLaPantalla = Readonly<{
  personaId: string;
  email: string;
  rol: RolDeEmpresa;
  activo: boolean;
}>;

/** Una invitación pendiente tal como la dibuja la lista; `venceEn` es un instante ISO UTC: la pantalla lo muestra en hora de Argentina. */
export type InvitacionParaLaPantalla = Readonly<{
  invitacionId: string;
  email: string;
  rol: RolDeEmpresa;
  venceEn: string;
  vencida: boolean;
}>;

export type ListaDeUsuariosParaLaPantalla = Readonly<{
  usuarios: readonly UsuarioParaLaPantalla[];
  invitaciones: readonly InvitacionParaLaPantalla[];
}>;

const delUsuario = (m: MiembroDeLista): UsuarioParaLaPantalla => ({
  personaId: m.personaId,
  email: m.email,
  rol: m.rol,
  activo: m.activo,
});

const delaInvitacion = (i: InvitacionPendienteDeLaLista): InvitacionParaLaPantalla => ({
  invitacionId: i.invitacionId,
  email: i.email,
  rol: i.rol,
  venceEn: i.venceEn,
  vencida: i.vencida,
});

/**
 * Los usuarios de la empresa y sus invitaciones pendientes (`usuarios.ver`), en el orden del servidor (email). Las dos consultas corren una tras otra: una falla y no sale nada.
 * Una invitación que la persona aceptó entre las dos lecturas puede figurar en ambas; con la lectura compartida de la página (una sola transacción) no ocurre.
 */
export function listarUsuarios(
  d: DependenciasDeUsuariosWeb,
  contexto: ContextoOperativo,
): Promise<Respuesta<ListaDeUsuariosParaLaPantalla>> {
  return lecturaDeUsuarios(
    d.respuesta,
    async () => {
      const miembros = await d.consultas().listarMiembros(contexto);
      if (!miembros.ok) return miembros;
      const invitaciones = await d.consultas().listarInvitacionesPendientes(contexto);
      if (!invitaciones.ok) return invitaciones;
      return ok({ miembros: miembros.valor, invitaciones: invitaciones.valor });
    },
    ({ miembros, invitaciones }) => ({
      usuarios: miembros.map(delUsuario),
      invitaciones: invitaciones.map(delaInvitacion),
    }),
  );
}

/**
 * La ficha de una persona de la empresa (`usuarios.ver`). `crudo`: `{ personaId }`, el de la dirección. Se busca entre los miembros de la empresa de la sesión: si no está
 * (inexistente o de otra empresa) es el genérico, sin decir cuál de las dos cosas pasó.
 */
export function fichaDeUsuario(
  d: DependenciasDeUsuariosWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<UsuarioParaLaPantalla>> {
  return accionDeUsuarios(
    d.respuesta,
    crudo,
    entradaDeFichaDeUsuario,
    async (entrada): Promise<Resultado<MiembroDeLista, unknown>> => {
      const miembros = await d.consultas().listarMiembros(contexto);
      if (!miembros.ok) return miembros;
      const miembro = miembros.valor.find((m) => m.personaId === entrada.personaId);
      return miembro === undefined ? err("MEMBRESIA_NO_ENCONTRADA") : ok(miembro);
    },
    delUsuario,
  );
}

/** La ficha de una invitación pendiente: la de la lista más las sucursales a las que se invitó (ids; la página las traduce a nombres con las de la empresa). `venceEn` es un instante ISO UTC. */
export type InvitacionParaLaFicha = InvitacionParaLaPantalla &
  Readonly<{ sucursales: readonly string[] }>;

/**
 * La ficha de una invitación pendiente (`usuarios.ver`). `crudo`: `{ invitacionId }`, el de la dirección. Se busca entre las pendientes de la empresa de la sesión: si no está (inexistente,
 * de otra empresa, ya aceptada o revocada) es el genérico, sin decir cuál de las cosas pasó.
 */
export function fichaDeInvitacion(
  d: DependenciasDeUsuariosWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<InvitacionParaLaFicha>> {
  return accionDeUsuarios(
    d.respuesta,
    crudo,
    entradaDeInvitacion,
    async (entrada): Promise<Resultado<InvitacionPendienteDeLaLista, unknown>> => {
      const invitaciones = await d.consultas().listarInvitacionesPendientes(contexto);
      if (!invitaciones.ok) return invitaciones;
      const invitacion = invitaciones.valor.find((i) => i.invitacionId === entrada.invitacionId);
      return invitacion === undefined ? err("INVITACION_NO_ENCONTRADA") : ok(invitacion);
    },
    (i) => ({ ...delaInvitacion(i), sucursales: [...i.sucursales] }),
  );
}

/** Lo que devuelve invitar. `yaExistia: true` NO es un error: ya había una invitación vigente del mismo rol para ese email, sin escribir ni mandar otro mail. */
export type InvitacionEmitida = Readonly<{ invitacionId: string; yaExistia: boolean }>;

/**
 * Invitar por mail (`usuarios.invitar`). `crudo`: `{ email, rol, sucursales }`. El resultado es la invitación que quedó (la nueva, o la que ya había: dos toques o dos personas a la vez dan
 * la MISMA). Con otra invitación vigente de OTRO rol no se hace pasar por hecho lo pedido: sale `USUARIOS_YA_HABIA_INVITACION`. Quien ya es parte: `USUARIOS_YA_ES_MIEMBRO`.
 */
export function invitar(
  d: DependenciasDeUsuariosWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<InvitacionEmitida>> {
  return accionDeUsuarios(
    d.respuesta,
    crudo,
    entradaDeInvitar,
    (entrada) => d.casosDeUso().invitarUsuario(contexto, entrada),
    (salida) => ({ invitacionId: salida.invitacionId, yaExistia: salida.yaExistia }),
  );
}

/** Lo que devuelve reenviar: la invitación vigente (la nueva, o la que ya había reemplazado a la de origen). */
export type InvitacionReenviada = Readonly<{ invitacionId: string; yaEstabaReenviada: boolean }>;

/** Reenviar una invitación (`usuarios.reenviar_invitacion`), vigente o vencida: el enlace anterior deja de servir y sale un mail nuevo. Repetirlo devuelve la misma nueva, sin otro mail. */
export function reenviar(
  d: DependenciasDeUsuariosWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<InvitacionReenviada>> {
  return accionDeUsuarios(
    d.respuesta,
    crudo,
    entradaDeInvitacion,
    (entrada) => d.casosDeUso().reenviarInvitacion(contexto, entrada),
    (salida) => ({
      invitacionId: salida.invitacionId,
      yaEstabaReenviada: salida.yaEstabaReenviada,
    }),
  );
}

/** Lo que devuelve revocar. */
export type InvitacionRevocada = Readonly<{ yaEstabaRevocada: boolean }>;

/** Revocar una invitación (`usuarios.revocar_invitacion`). Repetirlo no escribe ni audita otra vez. Una ya aceptada no se revoca: el genérico (se desactiva a la persona). */
export function revocar(
  d: DependenciasDeUsuariosWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<InvitacionRevocada>> {
  return accionDeUsuarios(
    d.respuesta,
    crudo,
    entradaDeInvitacion,
    (entrada) => d.casosDeUso().revocarInvitacion(contexto, entrada),
    (salida) => ({ yaEstabaRevocada: salida.yaEstabaRevocada }),
  );
}

/* ── U4: las sucursales de un empleado ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */

export type DependenciasDeSucursalesDeUsuarioWeb = Readonly<{
  consultas: () => Pick<ReturnType<Web["consultasDeIdentidad"]>, "listarMiembros">;
  consultasDeEmpresas: () => Pick<ReturnType<Web["consultasDeEmpresas"]>, "listarSucursales">;
  casosDeUso: () => Pick<ReturnType<Web["casosDeUsoDeIdentidad"]>, "asignarSucursales">;
  respuesta: DependenciasDeRespuesta;
}>;

/** Una sucursal ACTIVA que se ofrece en el editor, con su casilla: tildada si la persona la tiene en su asignación efectiva (asignación activa y sucursal activa). */
export type OpcionDeSucursalParaLaPantalla = Readonly<{
  id: string;
  nombre: string;
  marcada: boolean;
}>;

/** Lo que cambió al guardar (las tres listas del caso de uso, vacías si se guardó lo mismo). */
export type CambioDeSucursalesParaLaPantalla = Readonly<{
  agregadas: readonly string[];
  reactivadas: readonly string[];
  quitadas: readonly string[];
}>;

/**
 * Las sucursales de un EMPLEADO activo (rol `OPERADOR`), en el editor de su ficha, y el guardado de su conjunto final (tramo U4; dueño, 23/11/2026, preguntas 8 y 10 de
 * `plan-de-pantallas-usuarios-2026-11-23.md`: un empleado puede quedar sin sucursales; el editor es solo del empleado; dos ediciones a la vez: gana la última).
 * Reglas que cumple (cada una con su prueba en `test/integracion/usuarios-web-sucursales.test.ts`):
 *  - **La empresa y quien actúa salen de la sesión.** Del navegador solo viajan el id de la persona (la dirección, ligado con `bind`) y los ids de las casillas tildadas (lista blanca). Una persona
 *    o una sucursal de otra empresa es indistinguible de una inexistente: el genérico, sin escribir.
 *  - **El permiso es del servidor.** Las consultas (`usuarios.ver`, `sucursales.ver`) y el caso de uso (`usuarios.asignar_sucursales`) lo exigen al guard dentro de su transacción: sin permiso no sale
 *    ninguna casilla ni se escribe nada, aunque se llame por fuera de la pantalla. La pantalla no replica ninguna regla.
 *  - **Solo el empleado.** Para el gerente, el administrador o un empleado desactivado no hay editor ni se guarda nada (el genérico): ellos trabajan en todas las sucursales (H6 F1).
 *  - **Se manda el conjunto final**, no los cambios. Vacío es válido (se quitan todas, quedan apagadas, nunca borradas). Repetir el mismo conjunto, en otro orden o con repetidos, no escribe ni audita.
 *  - **Dos ediciones a la vez** dejan UNO de los dos conjuntos completo, nunca una mezcla (el caso de uso corre serializable y repite sobre el resultado de la primera).
 *  - **Todo o nada.** Las altas, reactivaciones, bajas y la auditoría `ASIGNACIONES_CAMBIADAS` salen en una transacción del caso de uso.
 *  - **Todo resultado sale por el camino común** (`aRespuesta`): un rechazo es el genérico y un fallo de la base sale con referencia, sin detalle.
 */

/** El miembro de la empresa de la sesión, o `MEMBRESIA_NO_ENCONTRADA` (la de otra empresa es indistinguible de la inexistente). */
async function miembroDeLaEmpresa(
  d: Pick<DependenciasDeSucursalesDeUsuarioWeb, "consultas">,
  contexto: ContextoOperativo,
  persona: PersonaId,
): Promise<Resultado<MiembroDeLista, unknown>> {
  const miembros = await d.consultas().listarMiembros(contexto);
  if (!miembros.ok) return miembros;
  const miembro = miembros.valor.find((m) => m.personaId === persona);
  return miembro === undefined ? err("MEMBRESIA_NO_ENCONTRADA") : ok(miembro);
}

const esEmpleadoActivo = (m: MiembroDeLista): boolean => m.activo && m.rol === "OPERADOR";

/**
 * Las casillas del editor de sucursales de la ficha de una persona (`usuarios.ver` y `sucursales.ver`). `crudo`: `{ personaId }`, el de la dirección. `null` si la persona no es un empleado
 * activo (no hay editor: la ficha no dice nada de sucursales). Solo se ofrecen las sucursales ACTIVAS; una asignación a una sucursal desactivada no cuenta y no se muestra.
 */
export function editorDeSucursalesDeUsuario(
  d: DependenciasDeSucursalesDeUsuarioWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<readonly OpcionDeSucursalParaLaPantalla[] | null>> {
  return accionDeUsuarios(
    d.respuesta,
    crudo,
    entradaDeFichaDeUsuario,
    async (
      entrada,
    ): Promise<
      Resultado<
        Readonly<{ miembro: MiembroDeLista; sucursales: readonly SucursalDeLista[] }> | null,
        unknown
      >
    > => {
      const miembro = await miembroDeLaEmpresa(d, contexto, entrada.personaId);
      if (!miembro.ok) return miembro;
      if (!esEmpleadoActivo(miembro.valor)) return ok(null);
      const sucursales = await d.consultasDeEmpresas().listarSucursales(contexto, {
        incluirInactivas: false,
      });
      if (!sucursales.ok) return sucursales;
      return ok({ miembro: miembro.valor, sucursales: sucursales.valor });
    },
    (salida) => {
      if (salida === null) return null;
      const tildadas = new Set<string>(salida.miembro.sucursales);
      return salida.sucursales.map((s) => ({
        id: s.id,
        nombre: s.nombre,
        marcada: tildadas.has(s.id),
      }));
    },
  );
}

/**
 * Guarda el conjunto final de sucursales de un empleado activo (`usuarios.asignar_sucursales`). `crudo`: `{ personaId, sucursales }`; `sucursales` son los ids tildados (puede ser `[]`).
 * Una persona que no es un empleado activo de la empresa de la sesión es el genérico, sin escribir.
 */
export function asignarSucursalesDeUsuario(
  d: DependenciasDeSucursalesDeUsuarioWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<CambioDeSucursalesParaLaPantalla>> {
  return accionDeUsuarios(
    d.respuesta,
    crudo,
    entradaDeAsignarSucursalesDeUsuario,
    async (entrada) => {
      const miembro = await miembroDeLaEmpresa(d, contexto, entrada.personaId);
      if (!miembro.ok) return miembro;
      if (!esEmpleadoActivo(miembro.valor)) return err("MEMBRESIA_NO_ES_DE_UN_EMPLEADO");
      return d.casosDeUso().asignarSucursales(contexto, {
        personaId: entrada.personaId,
        sucursales: entrada.sucursales,
      });
    },
    (cambio) => ({
      agregadas: [...cambio.agregadas],
      reactivadas: [...cambio.reactivadas],
      quitadas: [...cambio.quitadas],
    }),
  );
}
