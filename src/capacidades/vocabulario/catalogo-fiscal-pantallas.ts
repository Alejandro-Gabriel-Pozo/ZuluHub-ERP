/**
 * Los textos de las PANTALLAS del facturador (prefijo `fiscal.pantalla.*`), hoy la del detalle de un comprobante: los
 * rótulos, los siete estados (D-25), la etiqueta de anulación (D-29) y los avisos por estado de la guía de pantallas y
 * mensajes (§1.2). Viven aparte de `catalogo-fiscal.ts` (errores y mensajes de ARCA) para que ninguno de los dos crezca sin
 * tope; `catalogo.ts` los incluye y su prueba (`catalogo.test.ts`) los revisa como a todos. Castellano neutro y en
 * términos del negocio: ninguna palabra técnica ni el código crudo de nada. No se usa «acreditado» en lo que ve la
 * persona (D-29): se dice «anulado».
 *
 * Fuente de cada texto (verificable): PROTO = prototipo aprobado `detalle.html`; GUIA = `06-facturador-pantallas-y-mensajes.md`;
 * CONTRATO = `facturador-contratos-de-pantalla.md`. Un texto que no figure literalmente en una de las tres no entra:
 * lo prueba `catalogo.test.ts` solo en lo que puede (sin código crudo); la cita es la que se revisa a mano.
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
} as const;
