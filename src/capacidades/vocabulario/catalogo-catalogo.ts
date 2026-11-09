import type { DefinicionDeTexto } from "./catalogo";

/**
 * Los textos del módulo `catalogo` (prefijo `catalogo.`). Nace vacío (E0-T4): cada etapa que construye el módulo suma acá los suyos, cada uno con su
 * fuente verificable, sin tocar `catalogo.ts` (que ya lo incluye). Existe aparte para que E2, E3 y E4 no editen el mismo archivo.
 */
export const TEXTOS_DE_CATALOGO = {} as const satisfies Record<string, DefinicionDeTexto>;
