/**
 * Los textos de las PANTALLAS del facturador (prefijo `fiscal.pantalla.*`), hoy la del detalle de un comprobante: los
 * rótulos, los siete estados (D-25), la etiqueta de anulación (D-29) y los avisos por estado de la guía de pantallas y
 * mensajes (§1.2). Viven aparte de `catalogo-fiscal.ts` (errores y mensajes de ARCA) para que ninguno de los dos crezca sin
 * tope; `catalogo.ts` los incluye y su prueba (`catalogo.test.ts`) los revisa como a todos. Castellano neutro y en
 * términos del negocio: ninguna palabra técnica ni el código crudo de nada. No se usa «acreditado» en lo que ve la
 * persona (D-29): se dice «anulado».
 */
export const TEXTOS_DE_FISCAL_PANTALLAS = {
  "fiscal.pantalla.titulo": { porDefecto: "Comprobante" },

  // Qué es el comprobante: «Factura B 0001-00001234».
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

  // Los siete estados de un comprobante (D-25).
  "fiscal.pantalla.estado_pendiente": { porDefecto: "Pendiente de enviar" },
  "fiscal.pantalla.estado_en_validacion": { porDefecto: "Validando" },
  "fiscal.pantalla.estado_autorizado": { porDefecto: "Autorizada" },
  "fiscal.pantalla.estado_rechazado": { porDefecto: "Rechazada" },
  "fiscal.pantalla.estado_incierto": { porDefecto: "Confirmando" },
  "fiscal.pantalla.estado_conflicto": { porDefecto: "Requiere revisión" },
  "fiscal.pantalla.estado_descartado": { porDefecto: "Descartada" },

  // La etiqueta junto al estado «Autorizada» (D-29).
  "fiscal.pantalla.anulacion_parcial": { porDefecto: "Anulación parcial" },
  "fiscal.pantalla.anulacion_total": { porDefecto: "Anulación total" },

  // Rótulos de los datos.
  "fiscal.pantalla.rotulo_numero": { porDefecto: "Número" },
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

  // El cliente: el consumidor final y el tipo de documento.
  "fiscal.pantalla.consumidor_final": { porDefecto: "Consumidor final" },
  "fiscal.pantalla.documento": { porDefecto: "{tipo} {numero}", marcadores: ["numero", "tipo"] },
  "fiscal.pantalla.documento_cuit": { porDefecto: "CUIT" },
  "fiscal.pantalla.documento_cuil": { porDefecto: "CUIL" },
  "fiscal.pantalla.documento_cdi": { porDefecto: "CDI" },
  "fiscal.pantalla.documento_dni": { porDefecto: "DNI" },
  "fiscal.pantalla.documento_pasaporte": { porDefecto: "Pasaporte" },

  // Un renglón: «2 × $ 4.500,00» y «IVA 21 %».
  "fiscal.pantalla.renglon_cuenta": {
    porDefecto: "{cantidad} × {precio}",
    marcadores: ["cantidad", "precio"],
  },
  "fiscal.pantalla.renglon_iva": { porDefecto: "IVA {alicuota} %", marcadores: ["alicuota"] },

  // Lo ya anulado con notas de crédito (D-29).
  "fiscal.pantalla.ya_anulado": { porDefecto: "Ya anulado con notas de crédito" },
  "fiscal.pantalla.sin_notas": { porDefecto: "Sin notas" },

  // Los avisos por estado (guía de pantallas y mensajes §1.2).
  "fiscal.pantalla.aviso_validando_titulo": { porDefecto: "Validando con ARCA…" },
  "fiscal.pantalla.aviso_validando_detalle": { porDefecto: "Todavía no tiene número." },
  "fiscal.pantalla.aviso_incierto_titulo": { porDefecto: "ARCA no respondió a tiempo" },
  "fiscal.pantalla.aviso_incierto_detalle": {
    porDefecto: "Lo confirmamos solos en unos minutos consultando a ARCA. No lo emitas de nuevo.",
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
