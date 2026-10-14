import "server-only";

import { sistema } from "./composicion";

/**
 * ¿Tiene la base la migración que el código necesita (`MIGRACION_REQUERIDA`)? La pregunta la hace `proxy.ts`
 * en cada pedido que no es de sistema; la respuesta «sí» se memoriza en la instancia y un «no» se vuelve a
 * mirar a los 10 s (ver `src/composicion/guarda-de-migracion.ts`). Falla cerrado: lo que no se pudo averiguar
 * (el entorno sin armar, la conexión caída, el rol sin permiso de lectura sobre `migracion`) es «no», nunca
 * «todo bien», y esta función NO lanza: el proxy responde «En mantenimiento» (503) en vez de un error 500.
 */
export async function baseAlDia(): Promise<boolean> {
  try {
    return await sistema.guardaDeMigracion()();
  } catch {
    return false;
  }
}
