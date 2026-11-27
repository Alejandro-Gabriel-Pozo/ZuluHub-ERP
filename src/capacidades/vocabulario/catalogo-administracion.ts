import { TEXTOS_DE_ACCIONES_DE_ROLES } from "./textos-de-acciones-de-roles";
import { TEXTOS_DE_ROLES } from "./textos-de-roles";
import { TEXTOS_DE_SUCURSALES } from "./textos-de-sucursales";

/**
 * Los textos del módulo `administracion` que no son de Usuarios (`catalogo-usuarios.ts`): los de la pantalla «Roles» (`textos-de-roles.ts`), los de «Sucursales» (`textos-de-sucursales.ts`) y los nombres de las acciones de los roles propios (`textos-de-acciones-de-roles.ts`,
 * uno por acción del catálogo de módulos). Es la única parte dedicada de este módulo para el catálogo: `catalogo.ts` solo junta, así que lo propio de Roles se suma acá y no allá (regla de archivos centrales).
 */
export const TEXTOS_DE_ADMINISTRACION = {
  ...TEXTOS_DE_ACCIONES_DE_ROLES,
  ...TEXTOS_DE_ROLES,
  ...TEXTOS_DE_SUCURSALES,
} as const;
