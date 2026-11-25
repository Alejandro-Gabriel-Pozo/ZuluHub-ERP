/**
 * Las acciones de E6 que no entran en `catalogo.ts` (ya está en el tope de 400 líneas): lotes y calidad (módulo `stock`, tramo T7) y, con la
 * producción, las de `transformaciones.*` (módulo `produccion`, tramo T8/T9). `catalogo.ts` lo tipa al incluirlo (`DefinicionDeAccion`; este archivo no lo importa: sería un ciclo). Cada acción se declara junto con el caso de uso que la usa (cruce X1).
 * Efectos (E6 §3.6): mirar es `LECTURA`; cambiar la calidad y dejar de controlar cierran lo iniciado (se permiten en solo lectura); el resto crea o amplía.
 */
export const ACCIONES_DE_LOTES = {
  "lotes.ver": { capacidad: null, efecto: "LECTURA" },
  "lotes.controlar": { capacidad: null, efecto: "CREA_AMPLIA" },
  "lotes.dejar_de_controlar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
  "lotes.cambiar_calidad": { capacidad: null, efecto: "COMPLETA_CIERRA" },
  "lotes.corregir": { capacidad: null, efecto: "CREA_AMPLIA" },
  "lotes.reasignar": { capacidad: null, efecto: "CREA_AMPLIA" },
} as const;

/**
 * Producción (E6, `e6-recetas-produccion-especificacion.md` §3.2 y §3.6): módulo propio, `requiere: [stock]` (decisión del dueño del 26/10: «es bastante
 * complejo como para ser un módulo propio; eso lo aísla mejor»). Estaba `en_desarrollo` hasta que el dueño lo abrió para el hotel (25/11/2026, DEC-1050; PRO-A): ahora el guard lo deja pasar. Que una empresa lo use sigue dependiendo de que lo tenga
 * activo y de la perilla `produccion` (nace apagada). Efectos: mirar es `LECTURA`; abrir crea; cerrar, cancelar y anular cierran lo iniciado (se permiten en solo lectura).
 */
export const MODULO_DE_PRODUCCION = {
  estado: "disponible",
  obligatorio: false,
  requiere: ["stock"],
  usaSiExiste: ["catalogo"],
  datosRequeridos: [],
  implementadoPor: ["modulos/produccion"],
  acciones: {
    "transformaciones.ver": { capacidad: null, efecto: "LECTURA" },
    "transformaciones.abrir": { capacidad: null, efecto: "CREA_AMPLIA" },
    "transformaciones.cerrar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "transformaciones.cancelar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "transformaciones.anular": { capacidad: null, efecto: "COMPLETA_CIERRA" },
  },
} as const;
