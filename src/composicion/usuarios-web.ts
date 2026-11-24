import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { RolDeEmpresa } from "../capacidades/permisos/roles";
import type { ContextoOperativo } from "../contexto/contexto";
import type { InvitacionPendienteDeLaLista, MiembroDeLista } from "../modulos/identidad/publico";
import { err, ok, type Resultado } from "../primitivas/resultado/resultado";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import { entradaDeFichaDeUsuario } from "./entradas-de-usuarios";
import { accionDeUsuarios, lecturaDeUsuarios } from "./errores-de-usuarios";
import type { Web } from "./web";

/**
 * La pantalla «Usuarios» de /cuenta (tramo U1, solo lectura): la lista de quienes tienen acceso a la empresa con sus invitaciones pendientes, y la ficha de una persona.
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
 */

export type DependenciasDeUsuariosWeb = Readonly<{
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
