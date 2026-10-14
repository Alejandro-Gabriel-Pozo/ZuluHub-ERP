import "server-only";

import { sistema } from "./composicion";

/**
 * ¿Tiene la base la migración que el código necesita (`MIGRACION_REQUERIDA`)? La pregunta la hace `proxy.ts`
 * en cada pedido que no es de sistema; la respuesta «sí» se memoriza en la instancia y un «no» se vuelve a
 * mirar a los 10 s (ver `src/composicion/guarda-de-migracion.ts`). Falla cerrado.
 */
export const baseAlDia = (): Promise<boolean> => sistema.guardaDeMigracion()();
