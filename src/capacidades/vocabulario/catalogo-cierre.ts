/**
 * Los textos de la pantalla «Cierre del día» (prefijo `cierre.`), de a uno con su fuente verificable (DEC-0510). Todos son de la maqueta aceptada
 * `Pedernal-docs/10-ux-ui/prototipos-gastronomia/cierre-del-dia.html` (tres pasos; aceptada por el orquestador por delegación, DDD:183) y de su tabla «Textos nuevos».
 * `DDD:n` = fila `n` de `Pedernal-docs/11-especificaciones/decisiones-del-dueno-2026-11.md`.
 *
 *  - DDD:123 (14/11/2026, mensaje del dueño): los textos del cierre «tal cual» (estados, acciones, severidades, los doce controles, «Reconocer», «Conforme»,
 *    «Sin declarar», «Conforme general», «Corregir medio», «Medio correcto» y «Cambió algo mientras mirabas. Revisá y volvé a cerrar»).
 *  - DDD:126 (14/11/2026, mensaje del dueño): «Cobros corregidos», «Ajustes de días cerrados», «Reconocido por … · fecha y hora», «Registrado», «Declarado»,
 *    «Corregido por … · fecha y hora», «Cobros» y «Sin cuenta». Los marcadores no llevan espacios: `{persona}` es el correo de quien lo hizo (DDD:186, respuesta 26A) y
 *    `{cuando}` la fecha y la hora `DD/MM/AAAA hh:mm` (DDD:178).
 *  - DDD:183 (15/11/2026, delegación del dueño, DDD:173 y DDD:174): se aprueba «Siguiente» para pasar de un paso al otro; NO se aprueba «Paso 1 de 3».
 *  - «Cierre del día», «Jornada», «Abierta», «Cerrada», «Diferencia», «Cuenta de cobro», «Cancelar cierre» y «Volver»: ya aprobados (`e3b` §8.1 filas 1 y 2, la
 *    caja y `imprimir.html:327`), reutilizados por la maqueta (su tabla «(reutilizados)»). «Guardar», «Cancelar», «Motivo», «Efectivo» y los demás medios
 *    NO se repiten acá: se usan sus claves de `caja.*`, `catalogo.*` y `stock.*` (una regla, un lugar). El genérico «Esta acción no está permitida» sí tiene su clave
 *    propia (`cierre.error.accion_no_permitida`), como la tienen caja y catálogo: la tabla de códigos públicos no admite dos códigos con la misma clave.
 *  - «Diferencia por anulación de la mesa {mesa}» (`cierre.diferencia_por_anulacion_de_la_mesa`; DEC-SAL-009): son las palabras del dueño del 26/11/2026 (pidió que el cierre diga la anulación de la mesa y no solo un faltante, para que el gerente registre la
 *    salida); rotula una diferencia ya calculada de «Cobrado contra el ticket» sin cambiar dinero ni permisos; la acepta el orquestador por delegación (DDD:173).
 *  - «Ticket {numero}» (`cierre.ticket_numero`): está en la maqueta aceptada (`:426`, «Ticket 0007 · Diferencia $ …») pero no en su tabla de textos aprobados; por
 *    eso es una pregunta pendiente (DEC-0511).
 * «{persona} · {cuando}» (`cierre.cerrada_por`) es la línea de la franja «Cerrada» de la maqueta: no trae palabras nuevas, solo une quién y cuándo con el mismo «·» de
 * «Reconocido por» y «Corregido por».
 * Los doce controles de caja y de ventas se rotulan por la clave del control del servidor (`caja.sesiones_sin_cerrar` → `cierre.control.sesiones_sin_cerrar`: tabla
 * en `apps/web/ui/plantillas/cierre/modelo-del-cierre.ts`, comprobada contra los controles de los módulos). Los tres de stock no se muestran (DDD:183).
 */
export const TEXTOS_DE_CIERRE = {
  "cierre.titulo": { porDefecto: "Cierre del día" },
  "cierre.estado.en_auditoria": { porDefecto: "En cierre" },
  "cierre.accion.iniciar": { porDefecto: "Empezar el cierre" },
  "cierre.accion.cerrar": { porDefecto: "Cerrar el día" },
  "cierre.severidad.bloquea": { porDefecto: "Impide cerrar" },
  "cierre.severidad.reconocible": { porDefecto: "Hay que reconocer" },
  "cierre.severidad.informa": { porDefecto: "Solo informa" },
  "cierre.control.sesiones_sin_cerrar": { porDefecto: "Cajas sin cerrar" },
  "cierre.control.cuentas_abiertas": { porDefecto: "Cuentas abiertas sin cobrar" },
  "cierre.control.diferencia_de_arqueo": { porDefecto: "Diferencias de arqueo" },
  "cierre.control.conciliacion_por_medio": { porDefecto: "Conciliación por medio" },
  "cierre.control.cobrado_contra_ticket": { porDefecto: "Cobrado contra el ticket" },
  "cierre.control.tickets_por_cobrar": { porDefecto: "Tickets por cobrar" },
  "cierre.control.cortesias": { porDefecto: "Cortesías" },
  "cierre.control.anulaciones": { porDefecto: "Anulaciones" },
  "cierre.control.correcciones": { porDefecto: "Correcciones" },
  "cierre.control.pendientes_de_facturar": { porDefecto: "Pendientes de facturar" },
  "cierre.control.cobros_corregidos": { porDefecto: "Cobros corregidos" },
  "cierre.control.ajustes_a_jornadas_cerradas": { porDefecto: "Ajustes de días cerrados" },
  "cierre.reconocer": { porDefecto: "Reconocer" },
  "cierre.reconocido_por": {
    porDefecto: "Reconocido por {persona} · {cuando}",
    largoMaximo: 120,
    marcadores: ["persona", "cuando"],
  },
  "cierre.cerrada_por": {
    porDefecto: "{persona} · {cuando}",
    largoMaximo: 120,
    marcadores: ["persona", "cuando"],
  },
  "cierre.conciliacion.registrado": { porDefecto: "Registrado" },
  "cierre.conciliacion.correcciones": { porDefecto: "Correcciones" },
  "cierre.conciliacion.declarado": { porDefecto: "Declarado" },
  "cierre.corregir_medio": { porDefecto: "Corregir medio" },
  "cierre.medio_correcto": { porDefecto: "Medio correcto" },
  "cierre.corregido_por": {
    porDefecto: "Corregido por {persona} · {cuando}",
    largoMaximo: 120,
    marcadores: ["persona", "cuando"],
  },
  "cierre.ticket_numero": { porDefecto: "Ticket {numero}", marcadores: ["numero"] },
  "cierre.diferencia_por_anulacion_de_la_mesa": {
    porDefecto: "Diferencia por anulación de la mesa {mesa}",
    marcadores: ["mesa"],
  },
  "cierre.error.accion_no_permitida": { porDefecto: "Esta acción no está permitida" },
  "cierre.error.en_cierre": {
    porDefecto: "El día está en cierre. Cancelá el cierre para seguir",
    largoMaximo: 120,
  },
  "cierre.error.cerrada": { porDefecto: "El día ya está cerrado" },
  "cierre.error.controles_cambiaron": {
    porDefecto: "Cambió algo mientras mirabas. Revisá y volvé a cerrar",
    largoMaximo: 120,
  },
} as const;
