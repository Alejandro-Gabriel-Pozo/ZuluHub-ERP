import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";

/**
 * Lo que devuelven las acciones de servidor de invitar, reenviar y revocar a su pantalla (tramo U2), con la forma que lee `useActionState`. Ninguna acción redirige (un `redirect` dentro de una
 * acción pierde el host, precedente de Clientes): si salió bien dicen adónde ir y la pantalla navega con `window.location.assign`. Vive en la interfaz porque la leen los componentes de cliente;
 * el servidor la importa de acá (una regla, un lugar). Solo trae lo que la pantalla necesita: nunca un token ni el id de otra empresa.
 */

/** Invitar: nada todavía, hecho (vuelve a la lista), «ya había una invitación vigente» (un aviso, NO un error: quedó la que estaba) o el error ya traducido. */
export type ResultadoDeInvitar =
  | Readonly<{ estado: "INICIAL" }>
  | Readonly<{ estado: "HECHO" }>
  | Readonly<{ estado: "YA_HABIA" }>
  | Readonly<{ estado: "ERROR"; error: ErrorPublico }>;

export const INVITAR_INICIAL: ResultadoDeInvitar = { estado: "INICIAL" };

/** Reenviar y revocar: nada todavía, hecho (con la ruta a la que va la pantalla) o el error ya traducido. */
export type ResultadoDeAccionDeInvitacion =
  | Readonly<{ estado: "INICIAL" }>
  | Readonly<{ estado: "HECHO"; ruta: string }>
  | Readonly<{ estado: "ERROR"; error: ErrorPublico }>;

export const ACCION_DE_INVITACION_INICIAL: ResultadoDeAccionDeInvitacion = { estado: "INICIAL" };
