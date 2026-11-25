import type { ErrorPublico } from "../../../../../../src/capacidades/experiencia/respuesta";

/**
 * Lo que devuelven las acciones de confirmar y de anular una recepción a su pantalla (Compras 4), con la forma que lee `useActionState`. Ninguna redirige (un `redirect` dentro de una acción pierde
 * el host): si salió bien la pantalla recarga con `window.location.assign`. Vive en la interfaz porque lo leen componentes de cliente; el servidor lo importa (una regla, un lugar). Solo trae lo
 * que la pantalla necesita: nunca un id interno de más.
 */
export type ResultadoDeLaRecepcion =
  | Readonly<{ estado: "INICIAL" }>
  | Readonly<{ estado: "HECHO"; ruta: string }>
  | Readonly<{ estado: "ERROR"; error: ErrorPublico }>;

export const RECEPCION_INICIAL: ResultadoDeLaRecepcion = { estado: "INICIAL" };
