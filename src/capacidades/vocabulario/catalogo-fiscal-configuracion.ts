/**
 * Los textos de Configuración fiscal (prefijo `fiscal.pantalla.config_*`): la lista de lo que falta y las pantallas de Puntos de
 * venta (D-43). Viven aparte de `catalogo-fiscal-pantallas.ts` para que ninguno de los dos pase del tope de líneas; `catalogo.ts`
 * los incluye y `catalogo.test.ts` los revisa como a todos. Castellano neutro y en términos del negocio.
 *
 * Una línea de fuente por texto, con el cuestionario real y la pregunta (preguntas hechas al dueño con AskUserQuestion en la sesión
 * web del carril web, 2026-10-29):
 *   Q17 = cuestionario de las 17:45Z: P1 provincias, P2 textos de la lista, P3 textos de Puntos de venta, P4 textos de Datos fiscales.
 *   QA  = cuestionario A (21:08Z): P1 entrada, P2 sin puntos de venta, P3 rótulos y aviso de pruebas, P4 sucursal cerrada.
 *   QB  = cuestionario B (21:11Z): P1 accesos, P2 el certificado solo informa, P3 certificado sin punto de venta, P4 «Guardando…».
 *   CONTRATO-CONFIG = `facturador-contratos-de-pantalla.md` (D-43 a D-49 y D-60 a D-68); PROTO-PV = prototipo de Puntos de venta,
 *   opción A. Un texto marcado SUPUESTO es del ingeniero: el dueño no lo aprobó tal cual. Previene: dar por aprobado en bloque lo
 *   que se preguntó de a uno (o no se preguntó).
 */
export const TEXTOS_DE_FISCAL_CONFIGURACION = {
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 2 (título y subtítulo); el título también es el renglón de Cuenta:
  // cuestionario B (21:11Z), pregunta 1.
  "fiscal.pantalla.config_titulo": { porDefecto: "Configuración fiscal" },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 2.
  "fiscal.pantalla.config_subtitulo": { porDefecto: "Lo que hace falta para emitir comprobantes" },

  // Las tres filas de la lista. «Puntos de venta» es también el título de su pantalla.
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 2.
  "fiscal.pantalla.config_fila_datos_fiscales": { porDefecto: "Datos fiscales" },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 2.
  "fiscal.pantalla.config_puntos_de_venta": { porDefecto: "Puntos de venta" },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 2; que la fila solo informa y no es un enlace: cuestionario B, pregunta 2.
  "fiscal.pantalla.config_fila_certificado": { porDefecto: "Certificado de ARCA" },

  // Los carteles de la lista (un tema completo no lleva cartel): CONTRATO-CONFIG D-46 y D-64, que el cuestionario de las 17:45Z,
  // pregunta 2, cita como «ya aprobados» y el dueño aprobó «tal cual».
  // CONTRATO-CONFIG D-46; cuestionario de las 17:45Z, pregunta 2.
  "fiscal.pantalla.config_cartel_falta_cargar": { porDefecto: "Falta cargar" },
  // CONTRATO-CONFIG D-46; cuestionario de las 17:45Z, pregunta 2.
  "fiscal.pantalla.config_cartel_pendiente": { porDefecto: "Pendiente" },
  // CONTRATO-CONFIG D-46; cuestionario de las 17:45Z, pregunta 2.
  "fiscal.pantalla.config_cartel_falta_crear_uno": { porDefecto: "Falta crear uno" },
  // CONTRATO-CONFIG D-64; cuestionario de las 17:45Z, pregunta 2. Para el certificado: cuestionario B, pregunta 2.
  "fiscal.pantalla.config_cartel_vencido": { porDefecto: "Vencido" },
  // CONTRATO-CONFIG D-64; cuestionario de las 17:45Z, pregunta 2.
  "fiscal.pantalla.config_cartel_ninguno_activo": { porDefecto: "Ninguno activo" },

  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 3.
  "fiscal.pantalla.config_pv_agregar": { porDefecto: "Agregar punto de venta" },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 3.
  "fiscal.pantalla.config_pv_activo": { porDefecto: "Activo" },
  // SUPUESTO del ingeniero: «No activo» suelto, derivado de «00003 · No activo» (`listado_punto_de_venta_no_activo`), que el dueño
  // aprobó el 2026-10-29 a las 14:23Z para el filtro del Listado (D-58 y D-60); en Puntos de venta no se le preguntó tal cual.
  // Revertirlo es cambiar este texto.
  "fiscal.pantalla.config_pv_no_activo": { porDefecto: "No activo" },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 3.
  "fiscal.pantalla.config_pv_pruebas": { porDefecto: "Pruebas" },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 3.
  "fiscal.pantalla.config_pv_produccion": { porDefecto: "Producción" },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 3 (el botón y la ventana); D-48. El aviso de la ventana es el texto que
  // ya existe, `error.fiscal_ambiente_no_vuelve`.
  "fiscal.pantalla.config_pv_pasar_a_produccion": { porDefecto: "Pasar a producción" },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 3 («¿Pasar a producción?»).
  "fiscal.pantalla.config_pv_ventana_titulo": { porDefecto: "¿Pasar a producción?" },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 3.
  "fiscal.pantalla.config_pv_activar": { porDefecto: "Activar" },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 3.
  "fiscal.pantalla.config_pv_desactivar": { porDefecto: "Desactivar" },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 3.
  "fiscal.pantalla.config_pv_editar": { porDefecto: "Editar" },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 3.
  "fiscal.pantalla.config_pv_guardar": { porDefecto: "Guardar" },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 3.
  "fiscal.pantalla.config_pv_cancelar": { porDefecto: "Cancelar" },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 3.
  "fiscal.pantalla.config_pv_campo_numero": { porDefecto: "Número de punto de venta" },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 3.
  "fiscal.pantalla.config_pv_domicilio": { porDefecto: "Domicilio del punto de venta" },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 3.
  "fiscal.pantalla.config_pv_calle": { porDefecto: "Calle" },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 3 («Número»).
  "fiscal.pantalla.config_pv_numero_de_calle": { porDefecto: "Número" },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 3.
  "fiscal.pantalla.config_pv_piso": { porDefecto: "Piso" },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 3.
  "fiscal.pantalla.config_pv_departamento": { porDefecto: "Departamento" },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 3.
  "fiscal.pantalla.config_pv_localidad": { porDefecto: "Localidad" },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 3. También nombra la opción vacía del selector (accesibilidad, sin texto
  // nuevo).
  "fiscal.pantalla.config_pv_provincia": { porDefecto: "Provincia" },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 3.
  "fiscal.pantalla.config_pv_codigo_postal": { porDefecto: "Código postal" },
  // Dueño, 2026-10-29, cuestionario de las 17:45Z, pregunta 3.
  "fiscal.pantalla.config_pv_ayuda": {
    porDefecto: "Tocá un punto de venta para editarlo, activarlo o desactivarlo.",
    largoMaximo: 120,
  },
  // Dueño, 2026-10-29, cuestionario A (21:08Z), pregunta 2.
  "fiscal.pantalla.config_pv_vacio": { porDefecto: "Todavía no hay puntos de venta." },
  // Dueño, 2026-10-29, cuestionario A (21:08Z), pregunta 3 («Ambiente»). El rótulo «Estado» de la misma pregunta es
  // `listado_rotulo_estado` (mismo texto: una regla, un lugar).
  "fiscal.pantalla.config_pv_rotulo_ambiente": { porDefecto: "Ambiente" },
  // Dueño, 2026-10-29, cuestionario A (21:08Z), pregunta 3 (el aviso de pruebas).
  "fiscal.pantalla.config_pv_aviso_pruebas": {
    porDefecto: "Las facturas de pruebas no tienen valor fiscal.",
    largoMaximo: 120,
  },
  // Dueño, 2026-10-29, cuestionario B (21:11Z), pregunta 4 («Guardando…» en alta, edición y cambio de ambiente).
  // SUPUESTO del ingeniero: el mismo texto también en Activar y Desactivar; el dueño lo aprobó para alta, edición y cambio de
  // ambiente, no para estas dos acciones. Revertirlo es quitar `textoEnviando` de ese botón en `DetalleDelPuntoDeVenta.cliente.tsx`.
  "fiscal.pantalla.config_pv_guardando": { porDefecto: "Guardando…" },
  // Dueño, 2026-10-29, cuestionario B (21:11Z), pregunta 1: el pendiente de Inicio que lleva a la lista de Configuración fiscal.
  "fiscal.pantalla.config_pendiente_inicio": {
    porDefecto: "Completá la configuración fiscal.",
    largoMaximo: 120,
  },
  // PROTO-PV, pantalla 3 («Punto de venta 00002»): el título de un punto de venta. Lo muestra el prototipo; ningún cuestionario lo
  // nombra.
  "fiscal.pantalla.config_pv_titulo_con_numero": {
    porDefecto: "Punto de venta {numero}",
    marcadores: ["numero"],
  },
} as const;
