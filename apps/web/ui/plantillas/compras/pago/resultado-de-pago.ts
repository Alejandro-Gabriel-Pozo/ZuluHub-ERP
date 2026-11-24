import type { ErrorPublico } from "../../../../../../src/capacidades/experiencia/respuesta";

/**
 * Lo que devuelven las acciones de declarar y de anular un pago a su pantalla (Compras PR 8), con la forma que lee `useActionState`. Ninguna acción redirige (un `redirect` dentro de una acción pierde el host):
 * si salió bien la pantalla navega con `window.location.assign`. Vive en la interfaz porque lo leen componentes de cliente; el servidor lo importa de acá (una regla, un lugar).
 */
export type ResultadoDeDeclararPago =
  | Readonly<{ estado: "INICIAL" }>
  | Readonly<{ estado: "HECHO"; ruta: string }>
  | Readonly<{ estado: "ERROR"; error: ErrorPublico }>;

export const DECLARAR_PAGO_INICIAL: ResultadoDeDeclararPago = { estado: "INICIAL" };

export type ResultadoDeAnularPago =
  | Readonly<{ estado: "INICIAL" }>
  | Readonly<{ estado: "HECHO"; ruta: string }>
  | Readonly<{ estado: "ERROR"; error: ErrorPublico }>;

export const ANULAR_PAGO_INICIAL: ResultadoDeAnularPago = { estado: "INICIAL" };
