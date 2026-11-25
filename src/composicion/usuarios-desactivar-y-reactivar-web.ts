import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import type { SalidaDeInvitarUsuario } from "../modulos/identidad/publico";
import { err, type Resultado } from "../primitivas/resultado/resultado";
import { entradaDeDesactivarUsuario, entradaDeReactivarUsuario } from "./entradas-de-usuarios";
import { accionDeUsuarios } from "./errores-de-usuarios";
import type { DependenciasDeUsuariosWeb, InvitacionEmitida } from "./usuarios-web";

/**
 * Desactivar y reactivar a una persona de la empresa (tramo U3), en un archivo hermano de `usuarios-web.ts` (que está en el tope de tamaño). Misma regla que ahí: la empresa y quien actúa salen de la sesión;
 * del navegador solo viaja el id de la persona (y, al reactivar, las sucursales tildadas); el permiso y las reglas de quién puede qué son del caso de uso, no de esta capa; todo resultado sale por el camino
 * común (`accionDeUsuarios`, ADR-016). Se prueban con la base real en `test/integracion/usuarios-web-desactivar.test.ts` y `usuarios-web-reactivar.test.ts`.
 */

/** Lo que la pantalla necesita de una desactivación: solo si ya estaba hecha (la ficha se vuelve a leer). */
export type DesactivacionParaLaPantalla = Readonly<{ yaEstabaApagada: boolean }>;

/**
 * Desactivar a una persona de la empresa (`usuarios.apagar`): corta el acceso, apaga sus sucursales y revoca las invitaciones pendientes a su email, todo en una transacción.
 * `crudo`: `{ personaId }`, el de la ficha. Una persona de otra empresa o inexistente, el gerente, uno mismo y el último administrador salen todos como el genérico, sin decir cuál fue.
 */
export function desactivarUsuario(
  d: DependenciasDeUsuariosWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<DesactivacionParaLaPantalla>> {
  return accionDeUsuarios(
    d.respuesta,
    crudo,
    entradaDeDesactivarUsuario,
    (entrada) => d.casosDeUso().apagarMembresia(contexto, { personaId: entrada.personaId }),
    (salida) => ({ yaEstabaApagada: salida.yaEstabaApagada }),
  );
}

/**
 * Reactivar a una persona desactivada (`usuarios.ver` y `usuarios.invitar`): una INVITACIÓN NUEVA con el mismo rol (la persona vuelve al aceptarla). `crudo`: `{ personaId, sucursales }`. El email y el rol los toma el
 * servidor de la membresía de esa persona en la empresa de la sesión: el navegador no los manda (un rol distinto lo rechaza igual el caso de uso, `ROL_DISTINTO_AL_ANTERIOR`). Una persona ajena, inexistente, ya activa o el
 * gerente salen como el genérico. Repetir devuelve la misma invitación (`yaExistia`), sin segunda fila ni otro mail. Si en el medio dejó de estar desactivada, el caso de uso lo rechaza (`YA_ES_MIEMBRO`).
 */
export function reactivarUsuario(
  d: DependenciasDeUsuariosWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<InvitacionEmitida>> {
  return accionDeUsuarios(
    d.respuesta,
    crudo,
    entradaDeReactivarUsuario,
    async (entrada): Promise<Resultado<SalidaDeInvitarUsuario, unknown>> => {
      const miembros = await d.consultas().listarMiembros(contexto);
      if (!miembros.ok) return miembros;
      const miembro = miembros.valor.find((m) => m.personaId === entrada.personaId);
      if (miembro === undefined) return err("MEMBRESIA_NO_ENCONTRADA");
      if (miembro.activo) return err("NO_ESTA_DESACTIVADA");
      // Un rol propio no se invita: el gerente la pasa antes a un rol base (la base no deja reactivarla con otro rol).
      if (miembro.rol === "GERENTE" || miembro.rol === "PROPIO") return err("ROL_NO_INVITABLE");
      return d.casosDeUso().invitarUsuario(contexto, {
        email: miembro.email,
        rol: miembro.rol,
        sucursales: miembro.rol === "OPERADOR" ? entrada.sucursales : [],
      });
    },
    (salida) => ({ invitacionId: salida.invitacionId, yaExistia: salida.yaExistia }),
  );
}
