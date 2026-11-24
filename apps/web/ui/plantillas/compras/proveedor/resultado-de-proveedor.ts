import type { ErrorPublico } from "../../../../../../src/capacidades/experiencia/respuesta";

/**
 * Lo que devuelven las acciones de la ficha del proveedor de compras (Compras PR 4) a su pantalla, con la forma que lee `useActionState`. Ninguna acción redirige (un `redirect` dentro de una acción
 * pierde el host, precedente de Clientes): si salió bien la pantalla vuelve a cargar la ficha. «Ya estaba» (repetir un cambio que ya está hecho) también es éxito: no es un error. Vive en la interfaz
 * porque lo leen componentes de cliente; el servidor lo importa de acá (una regla, un lugar).
 */
export type ResultadoDeFichaDeProveedor =
  | Readonly<{ estado: "INICIAL" }>
  | Readonly<{ estado: "HECHO" }>
  | Readonly<{ estado: "ERROR"; error: ErrorPublico }>;

export const FICHA_DE_PROVEEDOR_INICIAL: ResultadoDeFichaDeProveedor = { estado: "INICIAL" };
