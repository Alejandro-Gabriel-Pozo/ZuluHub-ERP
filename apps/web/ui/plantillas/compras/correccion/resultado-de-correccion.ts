import type { ErrorPublico } from "../../../../../../src/capacidades/experiencia/respuesta";

/**
 * Lo que devuelven las acciones de corregir una línea y de anular una compra a su pantalla (Compras PR 10), con la forma que lee `useActionState`. Ninguna acción redirige (un `redirect` dentro de
 * una acción pierde el host): si salió bien la pantalla navega o recarga con `window.location.assign`. Vive en la interfaz porque lo leen componentes de cliente; el servidor lo importa de acá
 * (una regla, un lugar). Solo trae lo que la pantalla necesita: nunca un id interno de más.
 */

/** Corregir: nada todavía, hecho (con la ruta de la ficha, que ya muestra la corrección) o el error ya traducido. */
export type ResultadoDeCorregir =
  | Readonly<{ estado: "INICIAL" }>
  | Readonly<{ estado: "HECHO"; ruta: string }>
  | Readonly<{ estado: "ERROR"; error: ErrorPublico }>;

export const CORREGIR_INICIAL: ResultadoDeCorregir = { estado: "INICIAL" };

/** Anular: nada todavía, hecho (con la ruta de la ficha, que ya se ve «Anulada») o el error ya traducido; `consumida` = no se anuló porque lo que entró ya se usó (se ofrece «Corregir»). */
export type ResultadoDeAnular =
  | Readonly<{ estado: "INICIAL" }>
  | Readonly<{ estado: "HECHO"; ruta: string }>
  | Readonly<{ estado: "ERROR"; error: ErrorPublico; consumida: boolean }>;

export const ANULAR_INICIAL: ResultadoDeAnular = { estado: "INICIAL" };
