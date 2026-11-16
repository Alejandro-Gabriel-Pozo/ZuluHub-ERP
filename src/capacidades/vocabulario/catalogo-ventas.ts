/**
 * Los textos del módulo `ventas` (prefijo `ventas.`). Nació vacío (E0-T4): cada etapa que construye el módulo suma acá los suyos, cada uno con su
 * fuente verificable, sin tocar `catalogo.ts` (que ya lo incluye). Existe aparte para que E2, E3 y E4 no editen el mismo archivo.
 */
export const TEXTOS_DE_VENTAS = {
  // El genérico aprobado por el dueño el 30/10/2026 («Interfaz sobria»: mensaje genérico antes que uno por acción; `CLAUDE.md`); el mismo texto ya aprobado de `caja.error.accion_no_permitida`
  // (maqueta `medios.html`, 09/11/2026). Fuente de que ventas lo use: `servidor-del-mostrador-minimo.md` §8, «Los seis avisos sin texto usan el genérico».
  "ventas.error.accion_no_permitida": { porDefecto: "Esta acción no está permitida" },
} as const;
