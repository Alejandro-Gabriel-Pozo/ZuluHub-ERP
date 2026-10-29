/**
 * Los textos de las PANTALLAS del facturador (prefijo `fiscal.pantalla.*`), hoy la del detalle de un comprobante y la del
 * listado (sección «Listado» al final): los rótulos, los siete estados (D-25), la etiqueta de anulación (D-29) y los avisos por estado de la guía de pantallas y
 * mensajes (§1.2). Viven aparte de `catalogo-fiscal.ts` (errores y mensajes de ARCA) para que ninguno de los dos crezca sin
 * tope; `catalogo.ts` los incluye y su prueba (`catalogo.test.ts`) los revisa como a todos. Castellano neutro y en
 * términos del negocio: ninguna palabra técnica ni el código crudo de nada. No se usa «acreditado» en lo que ve la
 * persona (D-29): se dice «anulado».
 *
 * Fuente de cada texto (verificable): PROTO = prototipo aprobado `detalle.html`; GUIA = `06-facturador-pantallas-y-mensajes.md`;
 * CONTRATO = `facturador-contratos-de-pantalla.md`. Un texto que no figure literalmente en una de las tres no entra:
 * lo prueba `catalogo.test.ts` solo en lo que puede (sin código crudo); la cita es la que se revisa a mano.
 *
 * El listado cita, además, CONTRATO-LISTADO = la sección «Contrato de la pantalla 1: Listado de comprobantes» del mismo contrato y
 * MENSAJE-DUEÑO = lo que el dueño dijo con fecha. El prototipo `Listado.dc.html` NO es fuente. Un texto marcado «PROPUESTA sin
 * fuente verificable, pendiente del dueño» no figura en ninguna fuente: es del carril web y espera la aprobación del dueño.
 * RESPUESTA-DUEÑO-2026-10-29 = «dueño, 2026-10-29, respuesta en la sesión web del carril web» (cuestionario de opciones).
 */
export const TEXTOS_DE_FISCAL_PANTALLAS = {
  // PROTO: <title>Comprobante</title>.
  "fiscal.pantalla.titulo": { porDefecto: "Comprobante" },

  // Qué es el comprobante: «Factura B 0001-00001234» (CONTRATO: «Título "Factura B 0001-00001234"»; GUIA: «Corresponde a
  // Factura B 0001-00000042 del 14/10/2026»; «nota de crédito» y «nota de débito» en GUIA, en minúscula dentro de una frase).
  "fiscal.pantalla.tipo_factura": { porDefecto: "Factura" },
  "fiscal.pantalla.tipo_nota_de_credito": { porDefecto: "Nota de crédito" },
  "fiscal.pantalla.tipo_nota_de_debito": { porDefecto: "Nota de débito" },
  "fiscal.pantalla.comprobante_con_numero": {
    porDefecto: "{tipo} {letra} {numero}",
    marcadores: ["letra", "numero", "tipo"],
  },
  "fiscal.pantalla.comprobante_sin_numero": {
    porDefecto: "{tipo} {letra}",
    marcadores: ["letra", "tipo"],
  },
  "fiscal.pantalla.corresponde_a": {
    porDefecto: "Corresponde a {comprobante} del {fecha}",
    largoMaximo: 120,
    marcadores: ["comprobante", "fecha"],
  },

  // Los siete estados de un comprobante (D-25). CONTRATO D-25: «Pendiente = Pendiente de enviar; En validación = Validando;
  // Autorizado = Autorizada; Rechazado = Rechazada; Incierto = Confirmando; Conflicto = Requiere revisión; Descartado =
  // Descartada».
  "fiscal.pantalla.estado_pendiente": { porDefecto: "Pendiente de enviar" },
  "fiscal.pantalla.estado_en_validacion": { porDefecto: "Validando" },
  "fiscal.pantalla.estado_autorizado": { porDefecto: "Autorizada" },
  "fiscal.pantalla.estado_rechazado": { porDefecto: "Rechazada" },
  "fiscal.pantalla.estado_incierto": { porDefecto: "Confirmando" },
  "fiscal.pantalla.estado_conflicto": { porDefecto: "Requiere revisión" },
  "fiscal.pantalla.estado_descartado": { porDefecto: "Descartada" },

  // La etiqueta junto al estado «Autorizada». CONTRATO D-29: «Anulación parcial» o «Anulación total».
  "fiscal.pantalla.anulacion_parcial": { porDefecto: "Anulación parcial" },
  "fiscal.pantalla.anulacion_total": { porDefecto: "Anulación total" },

  // Rótulos de los datos. PROTO: «Fecha», «CAE», «Cliente», «Renglones», «Total» y «CAE … · vence 24/10/2026». «Punto de
  // venta»: CONTRATO («Punto de venta y origen» entre lo que se ve). No hay rótulo «Número»: ya está en el título.
  "fiscal.pantalla.rotulo_fecha": { porDefecto: "Fecha" },
  "fiscal.pantalla.rotulo_cae": { porDefecto: "CAE" },
  "fiscal.pantalla.cae_con_vencimiento": {
    porDefecto: "{cae} · vence {vencimiento}",
    marcadores: ["cae", "vencimiento"],
  },
  "fiscal.pantalla.rotulo_cliente": { porDefecto: "Cliente" },
  "fiscal.pantalla.rotulo_punto_de_venta": { porDefecto: "Punto de venta" },
  "fiscal.pantalla.rotulo_renglones": { porDefecto: "Renglones" },
  "fiscal.pantalla.rotulo_total": { porDefecto: "Total" },

  // El cliente: el consumidor final (PROTO) y el tipo de documento (GUIA: «CUIT o DNI»; CUIL, CDI y Pasaporte: aprobados por
  // el backend en su mensaje del 2026-10-28).
  "fiscal.pantalla.consumidor_final": { porDefecto: "Consumidor final" },
  "fiscal.pantalla.documento": { porDefecto: "{tipo} {numero}", marcadores: ["numero", "tipo"] },
  "fiscal.pantalla.documento_cuit": { porDefecto: "CUIT" },
  "fiscal.pantalla.documento_cuil": { porDefecto: "CUIL" },
  "fiscal.pantalla.documento_cdi": { porDefecto: "CDI" },
  "fiscal.pantalla.documento_dni": { porDefecto: "DNI" },
  "fiscal.pantalla.documento_pasaporte": { porDefecto: "Pasaporte" },

  // Un renglón: «2 × $ 4.500,00 · IVA 21 %» (PROTO).
  "fiscal.pantalla.renglon_cuenta": {
    porDefecto: "{cantidad} × {precio}",
    marcadores: ["cantidad", "precio"],
  },
  "fiscal.pantalla.renglon_iva": { porDefecto: "IVA {alicuota} %", marcadores: ["alicuota"] },

  // Lo ya anulado: CONTRATO D-29 «Ya anulado con notas de crédito» y CONTRATO «Se muestra "Sin notas"».
  "fiscal.pantalla.ya_anulado": { porDefecto: "Ya anulado con notas de crédito" },
  "fiscal.pantalla.sin_notas": { porDefecto: "Sin notas" },

  // Los avisos por estado. «Validando con ARCA…» GUIA §1.2 y PROTO; «Todavía no tiene número.» PROTO (sin la segunda frase del
  // prototipo); «ARCA no respondió a tiempo» y «Lo confirmamos solos
  // en unos minutos. No lo emitas de nuevo.» GUIA §1.2; «ARCA lo rechazó» PROTO; «Otro sistema usó este número en ARCA» y «El
  // punto de venta quedó bloqueado hasta resincronizar.» GUIA §1.2.
  "fiscal.pantalla.aviso_validando_titulo": { porDefecto: "Validando con ARCA…" },
  "fiscal.pantalla.aviso_validando_detalle": { porDefecto: "Todavía no tiene número." },
  "fiscal.pantalla.aviso_incierto_titulo": { porDefecto: "ARCA no respondió a tiempo" },
  "fiscal.pantalla.aviso_incierto_detalle": {
    porDefecto: "Lo confirmamos solos en unos minutos. No lo emitas de nuevo.",
    largoMaximo: 160,
  },
  "fiscal.pantalla.aviso_rechazado_titulo": { porDefecto: "ARCA lo rechazó" },
  "fiscal.pantalla.aviso_conflicto_titulo": {
    porDefecto: "Otro sistema usó este número en ARCA",
    largoMaximo: 120,
  },
  "fiscal.pantalla.aviso_conflicto_detalle": {
    porDefecto: "El punto de venta quedó bloqueado hasta resincronizar.",
    largoMaximo: 120,
  },

  // ---------------------------------------------------------------------------------------------------------------------
  // Listado de comprobantes (6A celular + 6C escritorio, control de período A). CONTRATO: «6a+6c aprobado» (dueño, 2026-10-28).
  // ---------------------------------------------------------------------------------------------------------------------

  // Aprobado por el dueño el 2026-10-29 (respuesta en la sesión web del carril web): el encabezado «Comprobantes» (celular y escritorio), que es también el
  // rótulo de la barra inferior. (La guía §P3 la llama «Comprobantes emitidos»; el contrato, «Listado de comprobantes».)
  "fiscal.pantalla.listado_titulo": { porDefecto: "Comprobantes" },

  // Rótulos de los filtros y de las columnas. CONTRATO-LISTADO, tabla de datos: «Período», «Estado», «Letra», «Punto de venta» (ya
  // está arriba: `rotulo_punto_de_venta`), «Búsqueda "Nombre o CUIT"» (el texto del campo de búsqueda), y la fila «Por fila: fecha,
  // comprobante (letra y número), cliente, documento, punto de venta, total, estado» (las columnas, con mayúscula inicial).
  "fiscal.pantalla.listado_rotulo_periodo": { porDefecto: "Período" },
  "fiscal.pantalla.listado_rotulo_estado": { porDefecto: "Estado" },
  "fiscal.pantalla.listado_rotulo_letra": { porDefecto: "Letra" },
  "fiscal.pantalla.listado_rotulo_buscar": { porDefecto: "Nombre o CUIT" },
  "fiscal.pantalla.listado_rotulo_comprobante": { porDefecto: "Comprobante" },
  "fiscal.pantalla.listado_rotulo_documento": { porDefecto: "Documento" },

  // Las opciones del período. CONTRATO-LISTADO: «Período (Hoy, Últimos 7 días, Este mes, Todo, Personalizado)». «Últimos 7 días»
  // incluye hoy (hoy y los 6 anteriores): D-54, confirmada por el dueño el 2026-10-29.
  "fiscal.pantalla.listado_periodo_hoy": { porDefecto: "Hoy" },
  "fiscal.pantalla.listado_periodo_ultimos_7_dias": { porDefecto: "Últimos 7 días" },
  "fiscal.pantalla.listado_periodo_este_mes": { porDefecto: "Este mes" },
  "fiscal.pantalla.listado_periodo_todo": { porDefecto: "Todo" },
  "fiscal.pantalla.listado_periodo_personalizado": { porDefecto: "Personalizado" },

  // Aprobado por el dueño el 2026-10-29 (respuesta en la sesión web del carril web): los rótulos de las dos fechas del período «Personalizado».
  // Fuente de la redacción: GUIA §4.6, `FECHAS_INVERTIDAS` («La fecha «desde» es posterior a «hasta».»).
  "fiscal.pantalla.listado_rotulo_desde": { porDefecto: "Desde" },
  "fiscal.pantalla.listado_rotulo_hasta": { porDefecto: "Hasta" },

  // «Sin filtrar» de las listas. CONTRATO-LISTADO: Estado «Todos», Punto de venta «Todos», Letra «Todas». El filtro de Estado
  // ofrece «Todos» y los siete estados de D-25 (D-52, confirmada por el dueño el 2026-10-29).
  "fiscal.pantalla.listado_todos": { porDefecto: "Todos" },
  "fiscal.pantalla.listado_todas": { porDefecto: "Todas" },

  // CONTRATO-LISTADO, «Acciones»: «"Filtros (n)" y "Limpiar"».
  "fiscal.pantalla.listado_filtros": {
    porDefecto: "Filtros ({cantidad})",
    marcadores: ["cantidad"],
  },
  "fiscal.pantalla.listado_limpiar": { porDefecto: "Limpiar" },

  // CONTRATO: paginación «Página siguiente».
  "fiscal.pantalla.listado_pagina_siguiente": { porDefecto: "Página siguiente" },

  // Filtro inválido en el listado. Fuente: guía `06-facturador-pantallas-y-mensajes.md` §4.6 (Consultas): `FECHAS_INVERTIDAS` «La fecha
  // «desde» es posterior a «hasta».» y `TEXTO_DEMASIADO_LARGO` «Buscá con menos letras.».
  "fiscal.pantalla.listado_error_fechas_invertidas": {
    porDefecto: "La fecha «desde» es posterior a «hasta».",
    largoMaximo: 120,
  },
  "fiscal.pantalla.listado_error_texto_demasiado_largo": {
    porDefecto: "Buscá con menos letras.",
    largoMaximo: 120,
  },

  // CONTRATO-LISTADO, «Estados»: vacío «No hay comprobantes con esos filtros. Probá con otro período o tocá «Limpiar».»; error «No pudimos cargar la lista. Probá de nuevo.» más la referencia PD-… (la referencia es `error.referencia`).
  "fiscal.pantalla.listado_vacio": {
    porDefecto: "No hay comprobantes con esos filtros. Probá con otro período o tocá «Limpiar».",
    largoMaximo: 160,
  },
  "fiscal.pantalla.listado_error": {
    porDefecto: "No pudimos cargar la lista. Probá de nuevo.",
    largoMaximo: 120,
  },

  // Aprobado por el dueño el 2026-10-29 (respuesta en la sesión web del carril web): el documento de un consumidor final sin identificar se ve «—».
  "fiscal.pantalla.listado_sin_documento": { porDefecto: "—" },

  // Aprobado por el dueño el 2026-10-29 (respuesta en la sesión web del carril web): el rótulo del selector de sucursal, la
  // invitación a elegir cuando todavía no eligió (D-36), el botón de esa elección «Ver comprobantes» (el del prototipo, «Ver {{cantidad}}
  // comprobantes», lleva la cantidad, que no va: D-32) y la marca de una sucursal cerrada (D-37; MENSAJE-DUEÑO, 2026-10-28:
  // «Sí, aparece marcada como cerrada»).
  "fiscal.pantalla.listado_rotulo_sucursal": { porDefecto: "Sucursal" },
  "fiscal.pantalla.listado_elegir_sucursal": {
    porDefecto: "Elegí una sucursal para ver sus comprobantes.",
    largoMaximo: 120,
  },
  "fiscal.pantalla.listado_ver_comprobantes": { porDefecto: "Ver comprobantes" },
  "fiscal.pantalla.listado_sucursal_cerrada": {
    porDefecto: "{nombre} · Cerrada",
    marcadores: ["nombre"],
  },
  // Aprobado por el dueño el 2026-10-29 (respuesta a un cuestionario en la sesión web del carril web; D-58 y D-60): en el filtro
  // «Punto de venta», el que no está activo (dado de baja o nuevo sin uso) se ve «00003 · No activo»; el activo, solo «00003».
  "fiscal.pantalla.listado_punto_de_venta_no_activo": {
    porDefecto: "{numero} · No activo",
    marcadores: ["numero"],
  },

  // RESPUESTA-DUEÑO-2026-10-29: el botón que aplica los filtros se llama «Aplicar filtros» (y «Ver comprobantes» queda solo para
  // la elección de sucursal), y la fecha que no existe en el calendario (por ejemplo 31 de febrero) se dice por campo.
  "fiscal.pantalla.listado_aplicar": { porDefecto: "Aplicar filtros" },
  "fiscal.pantalla.listado_error_fecha_desde_no_existe": {
    porDefecto: "La fecha «desde» no existe.",
    largoMaximo: 120,
  },
  "fiscal.pantalla.listado_error_fecha_hasta_no_existe": {
    porDefecto: "La fecha «hasta» no existe.",
    largoMaximo: 120,
  },
} as const;
