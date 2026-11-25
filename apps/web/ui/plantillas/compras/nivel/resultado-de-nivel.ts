import type { ErrorPublico } from "../../../../../../src/capacidades/experiencia/respuesta";

/**
 * Lo que devuelve la acción de guardar el nivel a su pantalla (Compras PR 11), con la forma que lee `useActionState`. Si salió bien trae el nivel y la versión que quedaron (la pantalla sigue
 * con ESA versión: un segundo guardado no choca con el primero); si no, el error ya traducido y, cuando el rechazo es de versión, el nivel que quedó para que la pantalla lo muestre. Vive en la
 * interfaz porque lo lee un componente de cliente; el servidor lo importa de acá (una regla, un lugar).
 */
export type ResultadoDeGuardarElNivel =
  | Readonly<{ estado: "INICIAL" }>
  | Readonly<{ estado: "HECHO"; nivel: string; version: number }>
  | Readonly<{
      estado: "ERROR";
      error: ErrorPublico;
      /** Lo vigente tras el rechazo (otra persona cambió el nivel antes); `null` si no se pudo leer. */
      vigente: Readonly<{ nivel: string; version: number }> | null;
    }>;

export const GUARDAR_EL_NIVEL_INICIAL: ResultadoDeGuardarElNivel = { estado: "INICIAL" };
