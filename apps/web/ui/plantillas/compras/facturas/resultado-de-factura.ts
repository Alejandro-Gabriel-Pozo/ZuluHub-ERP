import type { ErrorPublico } from "../../../../../../src/capacidades/experiencia/respuesta";

/**
 * Lo que devuelve la acción de anular una conciliación a su pantalla (Compras 4), con la forma que lee `useActionState`. No redirige (un `redirect` dentro de una acción pierde el host): si salió bien la pantalla
 * recarga con `window.location.assign`. Vive en la interfaz porque lo leen componentes de cliente; el servidor lo importa (una regla, un lugar).
 */
export type ResultadoDeLaFactura =
  | Readonly<{ estado: "INICIAL" }>
  | Readonly<{ estado: "HECHO"; ruta: string }>
  | Readonly<{ estado: "ERROR"; error: ErrorPublico }>;

export const FACTURA_INICIAL: ResultadoDeLaFactura = { estado: "INICIAL" };
