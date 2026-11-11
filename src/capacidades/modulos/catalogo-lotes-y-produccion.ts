import type { DefinicionDeAccion } from "./catalogo";

/**
 * Las acciones de E6 que no entran en `catalogo.ts` (ya está en el tope de 400 líneas): lotes y calidad (módulo `stock`, tramo T7) y, con la
 * producción, las de `transformaciones.*` (módulo `produccion`, tramo T8/T9). Cada acción se declara junto con el caso de uso que la usa (cruce X1).
 * Efectos (E6 §3.6): mirar es `LECTURA`; cambiar la calidad y dejar de controlar cierran lo iniciado (se permiten en solo lectura); el resto crea o amplía.
 */
export const ACCIONES_DE_LOTES = {
  "lotes.ver": { capacidad: null, efecto: "LECTURA" },
  "lotes.controlar": { capacidad: null, efecto: "CREA_AMPLIA" },
  "lotes.dejar_de_controlar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
  "lotes.cambiar_calidad": { capacidad: null, efecto: "COMPLETA_CIERRA" },
  "lotes.corregir": { capacidad: null, efecto: "CREA_AMPLIA" },
  "lotes.reasignar": { capacidad: null, efecto: "CREA_AMPLIA" },
} as const satisfies Readonly<Record<string, DefinicionDeAccion>>;
