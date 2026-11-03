/**
 * Los textos de «Emitir una factura» (8B, por pasos; prefijo `fiscal.pantalla.emitir_*`) y el «+ Emitir» del Listado. Viven aparte de
 * `catalogo-fiscal-pantallas.ts` para que ninguno pase del tope de líneas; `catalogo.ts` los incluye y `catalogo.test.ts` los revisa
 * como a todos. Lo que la pantalla ya podía decir con un texto existente NO tiene clave nueva (una regla, un lugar): «Cliente»,
 * «Renglones», «Total», «Punto de venta», «Documento», «Consumidor final», los nombres de los tipos de documento, «Condición frente al
 * IVA», «Siguiente», «Volver», «Enviando…», «IVA {alicuota} %», «Exento», «No gravado», «Pruebas» y su aviso (D-87) y «Ninguno activo».
 *
 * Una línea de fuente por texto. Siglas (repositorio de documentos (Pedernal-docs), salvo ARCA-016):
 *   PROTO-8B   = artefacto «Facturador: detalle y emitir» (`claude.ai/artifact/JpPY2SLKmaeZddVx6t1BRb`, `project/Emitir.dc.html`), opción B,
 *                aprobada por el dueño: «Si 7C y 8B» (2026-10-14 22:45Z, según el contrato, pantalla 3).
 *   CONTRATO   = `11-especificaciones/facturador-contratos-de-pantalla.md`.
 *   EMITIR-HTML, RECEPTOR-HTML = `10-ux-ui/prototipos-facturador/emitir.html` y `receptor.html`: fuente verificable del rótulo, pero NO son
 *                el prototipo que el dueño aprobó (el 8B): el rótulo espera su confirmación.
 *   ARCA-016   = `test/utilidades/arca-grabaciones/corrida1/016-FEParamGetCondicionIvaReceptor-respuesta-http200.xml` (los textos de la
 *                condición frente al IVA; la misma fuente que D-44 para los del emisor).
 *   SUPUESTO   = del ingeniero, sin fuente: el dueño no lo aprobó ni figura en un documento. Va en las preguntas pendientes del PR.
 */
export const TEXTOS_DE_FISCAL_EMITIR = {
  // PROTO-8B: el encabezado «Emitir factura»; CONTRATO, pantalla 3: el botón final «Emitir factura» (el mismo texto).
  "fiscal.pantalla.emitir_titulo": { porDefecto: "Emitir factura" },
  // PROTO-8B: el tercer paso, «3 Revisar» (los pasos 1 y 2 son «Cliente» y «Renglones», que ya existen).
  "fiscal.pantalla.emitir_paso_revisar": { porDefecto: "Revisar" },
  // PROTO-8B: el título del último paso, «Revisá y emití».
  "fiscal.pantalla.emitir_revisa_y_emiti": { porDefecto: "Revisá y emití" },
  // PROTO-8B: «+ Agregar renglón» (también EMITIR-HTML, línea 37).
  "fiscal.pantalla.emitir_agregar_renglon": { porDefecto: "+ Agregar renglón" },
  // CONTRATO, pantalla 1, «Acciones»: «+ Emitir» abre Emitir (`comprobantes.emitir_manual`).
  "fiscal.pantalla.listado_emitir": { porDefecto: "+ Emitir" },

  // EMITIR-HTML, línea 29: «Descripción».
  "fiscal.pantalla.emitir_descripcion": { porDefecto: "Descripción" },
  // EMITIR-HTML, línea 31: «Cantidad».
  "fiscal.pantalla.emitir_cantidad": { porDefecto: "Cantidad" },
  // EMITIR-HTML, línea 32: «Precio con IVA» (D-85: el precio de cada renglón es con IVA incluido).
  "fiscal.pantalla.emitir_precio_con_iva": { porDefecto: "Precio con IVA" },
  // EMITIR-HTML, línea 34: «IVA» (la alícuota del renglón).
  "fiscal.pantalla.emitir_iva": { porDefecto: "IVA" },
  // RECEPTOR-HTML, línea 20: «Nombre o razón social» (D-24: el receptor se escribe a mano).
  "fiscal.pantalla.emitir_nombre": { porDefecto: "Nombre o razón social" },

  // SUPUESTO: «Precio» donde la empresa no discrimina IVA (D-85: en letra C solo vale IVA incluido); como «Importe a anular» de D-75. Revertir: borrar la clave y usar siempre `emitir_precio_con_iva`.
  "fiscal.pantalla.emitir_precio": { porDefecto: "Precio" },
  // SUPUESTO: «Renglón {numero}» nombra cada grupo de campos (el lector de pantalla los distingue); la palabra es la de la guía `06-facturador-pantallas-y-mensajes.md`, §4.2, líneas 153 a 156.
  "fiscal.pantalla.emitir_renglon_numero": {
    porDefecto: "Renglón {numero}",
    marcadores: ["numero"],
  },
  // SUPUESTO: nada dice cómo se quita un renglón (el prototipo solo tiene «+ Agregar renglón»); sin quitarlo, uno agregado por error obliga a recargar.
  "fiscal.pantalla.emitir_quitar_renglon": {
    porDefecto: "Quitar renglón {numero}",
    marcadores: ["numero"],
  },
  // SUPUESTO: la opción de un punto de venta de pruebas, «00002 · Pruebas» (D-87 pide marcarlo con `config_pv_pruebas`); el formato «número · marca» es el de «00003 · No activo» (D-58, aprobado el 2026-10-29).
  "fiscal.pantalla.emitir_punto_de_venta_con_marca": {
    porDefecto: "{numero} · {marca}",
    marcadores: ["marca", "numero"],
  },

  // ARCA-016, Id 1: «IVA Responsable Inscripto» (igual a D-44, `opciones-de-datos-fiscales.ts`, en `composicion/`, que esta pantalla no puede importar).
  "fiscal.pantalla.emitir_condicion_responsable_inscripto": {
    porDefecto: "IVA Responsable Inscripto",
  },
  // ARCA-016, Id 6: «Responsable Monotributo» (igual a D-44).
  "fiscal.pantalla.emitir_condicion_monotributo": { porDefecto: "Responsable Monotributo" },
  // ARCA-016, Id 13: «Monotributista Social».
  "fiscal.pantalla.emitir_condicion_monotributista_social": {
    porDefecto: "Monotributista Social",
  },
  // ARCA-016, Id 16: «Monotributo Trabajador Independiente Promovido».
  "fiscal.pantalla.emitir_condicion_monotributo_promovido": {
    porDefecto: "Monotributo Trabajador Independiente Promovido",
    largoMaximo: 120,
  },
  // ARCA-016, Id 4: «IVA Sujeto Exento» (igual a D-44).
  "fiscal.pantalla.emitir_condicion_exento": { porDefecto: "IVA Sujeto Exento" },
  // ARCA-016, Id 7: «Sujeto No Categorizado».
  "fiscal.pantalla.emitir_condicion_no_categorizado": { porDefecto: "Sujeto No Categorizado" },
  // ARCA-016, Id 8: «Proveedor del Exterior».
  "fiscal.pantalla.emitir_condicion_proveedor_del_exterior": {
    porDefecto: "Proveedor del Exterior",
  },
  // ARCA-016, Id 9: «Cliente del Exterior».
  "fiscal.pantalla.emitir_condicion_cliente_del_exterior": { porDefecto: "Cliente del Exterior" },
  // ARCA-016, Id 10: «IVA Liberado – Ley N° 19.640».
  "fiscal.pantalla.emitir_condicion_iva_liberado": { porDefecto: "IVA Liberado – Ley N° 19.640" },
  // ARCA-016, Id 15: «IVA No Alcanzado».
  "fiscal.pantalla.emitir_condicion_iva_no_alcanzado": { porDefecto: "IVA No Alcanzado" },
  // ARCA-016, Id 5: «Consumidor Final».
  "fiscal.pantalla.emitir_condicion_consumidor_final": { porDefecto: "Consumidor Final" },
} as const;
