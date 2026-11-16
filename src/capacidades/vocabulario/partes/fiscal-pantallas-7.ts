/** Parte 7 de 7 de `TEXTOS_DE_FISCAL_PANTALLAS` (`catalogo-fiscal-pantallas.ts`, que la reexporta): se partió para no pasar del tope de líneas. Ninguna clave ni texto cambió. */
export const TEXTOS_DE_FISCAL_PANTALLAS_7 = {
  // DUEÑO-ANULAR (paso 2): «Motivo (obligatorio)», «Queda guardado junto a la nota de crédito.», el contador «0 / 200», «Se va a
  // emitir una nota de crédito B» (la letra según la factura) y «A anular ahora». El 200 es el límite del servidor
  // (`LIMITES_DE_COMPROBANTE.motivo`): lo trae la página, no se escribe acá.
  "fiscal.pantalla.anular_motivo": {
    porDefecto: "Motivo (obligatorio)",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-anulacion.ts",
        nombre: "armarLaVista",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.anular_motivo_guardado": {
    porDefecto: "Queda guardado junto a la nota de crédito.",
    largoMaximo: 120,
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-anulacion.ts",
        nombre: "armarLaVista",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.anular_contador": {
    porDefecto: "{cantidad} / {limite}",
    marcadores: ["cantidad", "limite"],
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-anulacion.ts",
        nombre: "contadorDelMotivo",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.anular_se_va_a_emitir": {
    porDefecto: "Se va a emitir una nota de crédito {letra}",
    marcadores: ["letra"],
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-anulacion.ts",
        nombre: "armarLaVista",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.anular_a_anular_ahora": {
    porDefecto: "A anular ahora",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-anulacion.ts",
        nombre: "armarLaVista",
      },
    ],
    fuente: "HEREDADO",
  },

  // D-74 (aprobado por el dueño el 2026-10-29, cuestionario en la sesión web del carril web): el texto de cada renglón de la nota lo arma el sistema con las palabras de
  // D-29, «Anulación parcial de la factura 00001-00000123, IVA 21 %» («Anulación total de …» si se anula todo; «nota de débito» en
  // lugar de «factura» si se anula una nota de débito). Va en el comprobante, no se le muestra a la persona. La alícuota sin IVA
  // (letra C, exento, no gravado) lleva el texto sin la coma final. «{anulacion}» es «Anulación parcial» o «Anulación total» (D-29).
  "fiscal.pantalla.anular_descripcion": {
    porDefecto: "{anulacion} de la {clase} {numero}",
    marcadores: ["anulacion", "clase", "numero"],
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/pedido-de-anulacion.ts",
        nombre: "descripcionDelRenglon",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.anular_descripcion_con_iva": {
    porDefecto: "{anulacion} de la {clase} {numero}, {iva}",
    marcadores: ["anulacion", "clase", "iva", "numero"],
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/pedido-de-anulacion.ts",
        nombre: "descripcionDelRenglon",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.anular_clase_factura": {
    porDefecto: "factura",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/pedido-de-anulacion.ts",
        nombre: "descripcionDelRenglon",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.anular_clase_nota_de_debito": {
    porDefecto: "nota de débito",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/pedido-de-anulacion.ts",
        nombre: "descripcionDelRenglon",
      },
    ],
    fuente: "HEREDADO",
  },

  // CONTRATO (pantalla 2, «Acciones»): «Anular con nota de crédito» es la acción del Detalle; GUIA §1.2 (estados del comprobante)
  // y el dueño, 2026-10-28 («Ver y Anular con nota de crédito»), lo nombran igual.
  "fiscal.pantalla.detalle_anular": {
    porDefecto: "Anular con nota de crédito",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-anulacion.ts",
        nombre: "accionDeAnularDelDetalle",
      },
    ],
    fuente: "HEREDADO",
  },
  // Aprobado por el dueño el 2026-10-29 (cuestionario en la sesión web del carril web; fuente D-10 y D-70): el motivo del botón
  // apagado en el Detalle de una factura o una nota de débito que no está Autorizada.
  "fiscal.pantalla.detalle_anular_motivo": {
    porDefecto: "Solo se anula una factura o una nota de débito Autorizada.",
    largoMaximo: 120,
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-anulacion.ts",
        nombre: "accionDeAnularDelDetalle",
      },
    ],
    fuente: "HEREDADO",
  },
} as const;
