/**
 * Los textos de «Emitir una factura» (8B, por pasos; prefijo `fiscal.pantalla.emitir_*`) y el «+ Emitir» del Listado. Viven aparte de
 * `catalogo-fiscal-pantallas.ts` para que ninguno pase del tope de líneas; `catalogo.ts` los incluye y `catalogo.test.ts` los revisa
 * como a todos. Lo que la pantalla ya podía decir con un texto existente NO tiene clave nueva (una regla, un lugar): «Cliente»,
 * «Renglones», «Total», «Punto de venta», «Documento», «Consumidor final», los nombres de los tipos de documento, «Condición frente al
 * IVA», «Siguiente», «Volver», «Enviando…», «IVA {alicuota} %», «Exento», «No gravado», «Pruebas» y su aviso (D-87) y «Ninguno activo».
 * Fuente de esos textos: figuran en PROTO-8B «Cliente», «Renglones», «Total» y «Volver» (el prototipo dibuja solo el paso 3; los textos
 * de los pasos 1 y 2 los cubre D-93); «Verificando si se registró…» es texto ya aprobado (D-93; el del contrato era una propuesta);
 * sin puntos de venta activos se usa «Ninguno activo» (D-64), aprobado por el dueño el 2026-11-03 (pregunta «Sin puntos»), sin texto nuevo.
 * Decisiones del dueño (2026-11-03, D-93 y D-95 de Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`): la sucursal es la del Listado
 * («Sucursal»); el error del servidor se ve en el paso final y se vuelve con «Volver», sin marcar campos («Errores»); «Verificando…» no tiene
 * salida («Verificando»).
 *
 * Una línea de fuente por texto. Siglas (repositorio de documentos (Pedernal-docs), salvo ARCA-016):
 *   PROTO-8B   = artefacto «Facturador: detalle y emitir» (`claude.ai/artifact/JpPY2SLKmaeZddVx6t1BRb`, `project/Emitir.dc.html`), opción B,
 *                aprobada por el dueño: «Si 7C y 8B» (2026-10-14 22:45Z, según el contrato, pantalla 3).
 *   CONTRATO   = `11-especificaciones/facturador-contratos-de-pantalla.md`.
 *   EMITIR-HTML, RECEPTOR-HTML = `10-ux-ui/prototipos-facturador/emitir.html` y `receptor.html`: de donde salen los rótulos (no son el
 *                prototipo 8B; los rótulos los aprobó el dueño: ver D-93).
 *   D-93 / D-95 = filas del CONTRATO (Pedernal-docs), confirmadas por el dueño el 2026-11-03 (D-93) y el 2026-11-04 (D-95); cada texto cita su punto.
 *   ARCA-016   = `test/utilidades/arca-grabaciones/corrida1/016-FEParamGetCondicionIvaReceptor-respuesta-http200.xml` (los textos de la
 *                condición frente al IVA; la misma fuente que D-44 para los del emisor).
 *   SUPUESTO (DEC-0049)   = del ingeniero, sin fuente: el dueño no lo aprobó ni figura en un documento. Va en las preguntas pendientes del PR (hoy ninguno).
 */
export const TEXTOS_DE_FISCAL_EMITIR = {
  // PROTO-8B (figura en el prototipo aprobado, artboard «8 · Emitir una factura», columna «B · Por pasos»): el encabezado «Emitir factura»; CONTRATO, pantalla 3: el botón final «Emitir factura» (el mismo texto).
  "fiscal.pantalla.emitir_titulo": { porDefecto: "Emitir factura" },
  // PROTO-8B (figura en el prototipo aprobado; no cambiar «Revisar»): el tercer paso, «3 Revisar» (los pasos 1 y 2 son «Cliente» y «Renglones», que ya existen).
  "fiscal.pantalla.emitir_paso_revisar": { porDefecto: "Revisar" },
  // PROTO-8B (figura en el prototipo aprobado; no cambiar «Revisá y emití»): el título del último paso, «Revisá y emití».
  "fiscal.pantalla.emitir_revisa_y_emiti": { porDefecto: "Revisá y emití" },
  // Dueño, 2026-11-04, aprobado tal cual (D-95; chat de la sesión web). Origen: el prototipo viejo EMITIR-HTML, línea 37.
  "fiscal.pantalla.emitir_agregar_renglon": { porDefecto: "+ Agregar renglón" },
  // CONTRATO, pantalla 1, «Acciones»: «+ Emitir» abre Emitir (`comprobantes.emitir_manual`).
  // D-93 / D-95 (Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`, 2026-11-03), punto 7: NO se muestra cuando la persona no puede emitir.
  "fiscal.pantalla.listado_emitir": { porDefecto: "+ Emitir" },

  // EMITIR-HTML, línea 29: «Descripción».
  // D-93 / D-95 (Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`, 2026-11-03), punto 2: rótulos aprobados tal cual.
  "fiscal.pantalla.emitir_descripcion": { porDefecto: "Descripción" },
  // EMITIR-HTML, línea 31: «Cantidad».
  // D-93 / D-95 (Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`, 2026-11-03), punto 2: rótulos aprobados tal cual.
  "fiscal.pantalla.emitir_cantidad": { porDefecto: "Cantidad" },
  // EMITIR-HTML, línea 32: «Precio con IVA» (D-85: el precio de cada renglón es con IVA incluido).
  // D-93 / D-95 (Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`, 2026-11-03), punto 2: rótulos aprobados tal cual.
  "fiscal.pantalla.emitir_precio_con_iva": { porDefecto: "Precio con IVA" },
  // EMITIR-HTML, línea 34: «IVA» (la alícuota del renglón).
  // D-93 / D-95 (Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`, 2026-11-03), punto 2: rótulos aprobados tal cual.
  "fiscal.pantalla.emitir_iva": { porDefecto: "IVA" },
  // RECEPTOR-HTML, línea 20: «Nombre o razón social» (D-24: el receptor se escribe a mano).
  // D-93 / D-95 (Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`, 2026-11-03), punto 2: rótulos aprobados tal cual.
  "fiscal.pantalla.emitir_nombre": { porDefecto: "Nombre o razón social" },

  // D-93 / D-95 (Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`, 2026-11-03), punto 4: «Precio» donde la empresa no discrimina IVA (D-85: en letra C solo vale IVA incluido); como «Importe a anular» de D-75.
  "fiscal.pantalla.emitir_precio": { porDefecto: "Precio" },
  // D-93 / D-95 (Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`, 2026-11-03), punto 4: «Renglón {numero}» nombra cada grupo de campos (el lector de pantalla los distingue); la palabra es la de la guía `06-facturador-pantallas-y-mensajes.md`, §4.2, líneas 153 a 156.
  "fiscal.pantalla.emitir_renglon_numero": {
    porDefecto: "Renglón {numero}",
    marcadores: ["numero"],
  },
  // D-93 / D-95 (Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`, 2026-11-03), punto 4: se pueden quitar renglones («Quitar renglón {numero}»).
  "fiscal.pantalla.emitir_quitar_renglon": {
    porDefecto: "Quitar renglón {numero}",
    marcadores: ["numero"],
  },
  // D-93 / D-95 (Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`, 2026-11-03), punto 4: la opción de un punto de venta de pruebas, «00002 · Pruebas» (D-87 pide marcarlo con `config_pv_pruebas`); la plantilla es el punto 4 de D-93, «{número} · Pruebas» (la usa `etiquetaDelPunto`).
  "fiscal.pantalla.emitir_punto_de_venta_con_marca": {
    porDefecto: "{numero} · {marca}",
    marcadores: ["marca", "numero"],
  },

  // D-93 / D-95 (Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`, 2026-11-03), punto 3: se ofrecen las 11. ARCA-016, Id 1: «IVA Responsable Inscripto» (igual a D-44, `opciones-de-datos-fiscales.ts`, en `composicion/`, que esta pantalla no puede importar).
  "fiscal.pantalla.emitir_condicion_responsable_inscripto": {
    porDefecto: "IVA Responsable Inscripto",
  },
  // D-93 / D-95 (Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`, 2026-11-03), punto 3: se ofrecen las 11. ARCA-016, Id 6: «Responsable Monotributo» (igual a D-44).
  "fiscal.pantalla.emitir_condicion_monotributo": { porDefecto: "Responsable Monotributo" },
  // D-93 / D-95 (Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`, 2026-11-03), punto 3: se ofrecen las 11. ARCA-016, Id 13: «Monotributista Social».
  "fiscal.pantalla.emitir_condicion_monotributista_social": {
    porDefecto: "Monotributista Social",
  },
  // D-93 / D-95 (Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`, 2026-11-03), punto 3: se ofrecen las 11. ARCA-016, Id 16: «Monotributo Trabajador Independiente Promovido».
  "fiscal.pantalla.emitir_condicion_monotributo_promovido": {
    porDefecto: "Monotributo Trabajador Independiente Promovido",
    largoMaximo: 120,
  },
  // D-93 / D-95 (Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`, 2026-11-03), punto 3: se ofrecen las 11. ARCA-016, Id 4: «IVA Sujeto Exento» (igual a D-44).
  "fiscal.pantalla.emitir_condicion_exento": { porDefecto: "IVA Sujeto Exento" },
  // D-93 / D-95 (Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`, 2026-11-03), punto 3: se ofrecen las 11. ARCA-016, Id 7: «Sujeto No Categorizado».
  "fiscal.pantalla.emitir_condicion_no_categorizado": { porDefecto: "Sujeto No Categorizado" },
  // D-93 / D-95 (Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`, 2026-11-03), punto 3: se ofrecen las 11. ARCA-016, Id 8: «Proveedor del Exterior».
  "fiscal.pantalla.emitir_condicion_proveedor_del_exterior": {
    porDefecto: "Proveedor del Exterior",
  },
  // D-93 / D-95 (Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`, 2026-11-03), punto 3: se ofrecen las 11. ARCA-016, Id 9: «Cliente del Exterior».
  "fiscal.pantalla.emitir_condicion_cliente_del_exterior": { porDefecto: "Cliente del Exterior" },
  // D-93 / D-95 (Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`, 2026-11-03), punto 3: se ofrecen las 11. ARCA-016, Id 10: «IVA Liberado – Ley N° 19.640».
  "fiscal.pantalla.emitir_condicion_iva_liberado": { porDefecto: "IVA Liberado – Ley N° 19.640" },
  // D-93 / D-95 (Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`, 2026-11-03), punto 3: se ofrecen las 11. ARCA-016, Id 15: «IVA No Alcanzado».
  "fiscal.pantalla.emitir_condicion_iva_no_alcanzado": { porDefecto: "IVA No Alcanzado" },
  // D-93 / D-95 (Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`, 2026-11-03), punto 3: se ofrecen las 11. ARCA-016, Id 5: «Consumidor Final».
  "fiscal.pantalla.emitir_condicion_consumidor_final": { porDefecto: "Consumidor Final" },

  // E1 §10 (`Pedernal-docs/11-especificaciones/e1-facturador-especificacion.md`): textos de facturar un ticket. POR APROBAR por el dueño (S5 §3).
  // «Venta» de `venta-rapida.html:352`; «N.º» de `ticket.html:24`; la combinación («Venta N.º 124») es la de `emitir.html?estado=venta` (prototipos-facturador).
  "fiscal.pantalla.emitir_venta_numero": {
    porDefecto: "Venta N.º {numero}",
    marcadores: ["numero"],
  },
  // Encargo S5 (`orquestacion-ola-1.md`), decisión 57 (`catalogo-y-niveles-maqueta.md:1333`) y el prototipo `listado.html` (`index.html:11`): el título de la lista y el enlace que lleva a ella.
  "fiscal.pantalla.pendientes_titulo": { porDefecto: "Pendientes de facturar" },
  // Decisión 175 (lo menos posible) y el patrón del aviso vacío de `listado.html`; el vacío de comprobantes («Todavía no emitiste comprobantes») sería falso acá.
  "fiscal.pantalla.pendientes_vacio": { porDefecto: "No hay ventas pendientes de facturar" },
} as const;
