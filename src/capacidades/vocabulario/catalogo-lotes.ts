/**
 * Los textos de los lotes, la calidad y los vencimientos (prefijo `lotes.`, E6 §10). Ninguno es nuevo: todos salen de `control.html`, sección
 * «Textos nuevos» (línea 278, `10-ux-ui/prototipos-gastronomia/`, repositorio de documentos), que el dueño aprobó el 09/11/2026 (decisión D118).
 * Los errores `VENCIMIENTO_REQUERIDO` («Falta la fecha de vencimiento») y `VENCIMIENTO_PASADO` («Ya está vencido») son de la misma lista, fila
 * «Recibir». Lo que esa lista no trae (`LOTE_SIN_CALIDAD`, `LOTE_DESACTUALIZADO`…) se muestra con el mensaje genérico (D175).
 */
export const TEXTOS_DE_LOTES = {
  // control.html «Textos nuevos», fila «Cuarentena».
  "lotes.calidad.cuarentena": { porDefecto: "Cuarentena" },
  "lotes.calidad.en_cuarentena": { porDefecto: "En cuarentena" },
  "lotes.calidad.en_revision": { porDefecto: "En revisión" },
  "lotes.calidad.liberar": { porDefecto: "Liberar" },
  "lotes.calidad.rechazar": { porDefecto: "Rechazar" },
  "lotes.calidad.dejar_en_revision": { porDefecto: "Dejar en revisión" },
  "lotes.calidad.no_se_puede_vender_ni_usar": { porDefecto: "No se puede vender ni usar" },
  // control.html, fila «Vencimientos».
  "lotes.vencimiento.por_vencer": { porDefecto: "Por vencer" },
  "lotes.vencimiento.vencido": { porDefecto: "Vencido" },
  "lotes.vencimiento.vence_hoy": { porDefecto: "Vence hoy" },
  "lotes.vencimiento.vence_en_dias": { porDefecto: "Vence en {dias} días", marcadores: ["dias"] },
  "lotes.vencimiento.dar_de_baja": { porDefecto: "Dar de baja por vencimiento" },
  "lotes.vencimiento.se_pierde": { porDefecto: "Se pierde" },
  // control.html, fila «Recibir» (campos del lote y errores de la fecha).
  "lotes.lote.lote": { porDefecto: "Lote" },
  "lotes.lote.vence": { porDefecto: "Vence" },
  "lotes.error.vencimiento_requerido": { porDefecto: "Falta la fecha de vencimiento" },
  "lotes.error.vencimiento_pasado": { porDefecto: "Ya está vencido" },
  // control.html, fila «Sin permiso» (texto ya aprobado).
  "lotes.error.sin_permiso": { porDefecto: "Esta acción no está permitida" },
} as const;
