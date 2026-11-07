/**
 * Los textos de la vista imprimible de un comprobante (prefijo `fiscal.pantalla.imprimir_*`): el botón «Imprimir» del Detalle, los dos
 * formatos y lo que la hoja dibuja y no tenía texto. Viven aparte de `catalogo-fiscal-pantallas.ts` para que ninguno pase del tope de
 * líneas; `catalogo.ts` los incluye y `catalogo.test.ts` los revisa como a todos. Lo que la hoja ya podía decir con un texto existente NO
 * tiene clave nueva (una regla, un lugar): «Fecha», «CAE», «{cae} · vence {vencimiento}», «Cliente», «Total», «CUIT», «DNI», «Consumidor
 * final», «Razón social», «Domicilio», «Domicilio del punto de venta», «Condición frente al IVA», «Inicio de actividades»,
 * «Descripción», «Cantidad», «Precio con IVA», «Precio», «IVA», «IVA {alicuota} %», «Corresponde a {comprobante} del {fecha}»,
 * «Exento» y «No gravado». «A CONSUMIDOR FINAL», los rótulos de Transparencia Fiscal y sus títulos NO están acá: los trae el modelo de
 * impresión (versión 2), que los copia de la norma.
 *
 * Fuente de todos: el dueño, 2026-11-04, aprobados tal cual (D-111; `11-especificaciones/facturador-contratos-de-pantalla.md` del repositorio
 * de documentos, Pedernal-docs). Una línea de fuente por texto; las normas son las de `12-referencias-externas/arca-normas-de-comprobantes/`.
 */
export const TEXTOS_DE_FISCAL_IMPRIMIR = {
  // Dueño, 2026-11-04, D-111: el botón del Detalle que abre la vista imprimible.
  "fiscal.pantalla.imprimir_boton": { porDefecto: "Imprimir" },
  // Dueño, 2026-11-04, D-111: el formato A4 (D-100).
  "fiscal.pantalla.imprimir_formato_a4": { porDefecto: "A4" },
  // Dueño, 2026-11-04, D-111: el formato de 80 mm (D-100).
  "fiscal.pantalla.imprimir_formato_ticket": { porDefecto: "Ticket" },
  // Dueño, 2026-11-04, D-111: el encabezado de la columna del importe de cada renglón (prototipo v8, aprobado).
  "fiscal.pantalla.imprimir_rotulo_importe": { porDefecto: "Importe" },
  // Dueño, 2026-11-04, D-111: la fila del neto de la letra A, una por alícuota (prototipo v8).
  "fiscal.pantalla.imprimir_neto_gravado": {
    porDefecto: "Neto gravado {alicuota} %",
    marcadores: ["alicuota"],
  },
  // Dueño, 2026-11-04, D-111: «COD.» antes del código del tipo de comprobante de tres dígitos (RG 1415, Anexo II, A.I.f; prototipo v8).
  "fiscal.pantalla.imprimir_codigo": { porDefecto: "COD." },
  // Dueño, 2026-11-04, D-111 y D-105: el parcial que cierra una hoja que no es la última (RG 1415, Anexo IV, punto 6 b) 2).
  "fiscal.pantalla.imprimir_a_transportar": { porDefecto: "A transportar" },
  // Dueño, 2026-11-04, D-111 y D-105: la primera fila de una hoja que continúa, con el parcial de la anterior (RG 1415, Anexo IV, punto 6 b) 2).
  "fiscal.pantalla.imprimir_transporte": { porDefecto: "Transporte" },
  // Dueño, 2026-11-04, D-105: la numeración de las hojas, «Hoja 2 de 3». RG 1415, Anexo IV, punto 6 b) 2: «Hoja 1 de n; 2 de n; … n de n»
  // (Pedernal-docs/12-referencias-externas/arca-normas-de-comprobantes/rg1415_dcp.html).
  "fiscal.pantalla.imprimir_hoja": { porDefecto: "Hoja {k} de {n}", marcadores: ["k", "n"] },
  // Dueño, 2026-11-04, D-112: el rótulo del número de ingresos brutos del emisor. RG 1415, Anexo II, A.I.a punto 4: «Número de inscripción del
  // impuesto sobre los ingresos brutos o condición de no contribuyente»; la norma no fija el rótulo, lo aprobó el dueño. Sin número, la línea
  // se omite (SUPUESTO D-112).
  "fiscal.pantalla.imprimir_ingresos_brutos": { porDefecto: "Ingresos Brutos" },
  // Dueño, 2026-11-05, mensaje en la sesión del PDF («Apruebo el botón descargar PDFs»; el texto «Descargar PDF» es el de la propuesta técnica de la
  // Fase 1 de esa fecha, punto (d)), ratificado por el orquestador el mismo día. Pedido original: «que el usuario pueda DESCARGAR la factura como PDF».
  "fiscal.pantalla.imprimir_descargar_pdf": { porDefecto: "Descargar PDF" },
} as const;
