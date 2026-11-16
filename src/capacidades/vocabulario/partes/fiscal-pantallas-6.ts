/** Parte 6 de 7 de `TEXTOS_DE_FISCAL_PANTALLAS` (`catalogo-fiscal-pantallas.ts`, que la reexporta): se partió para no pasar del tope de líneas. Ninguna clave ni texto cambió. */
export const TEXTOS_DE_FISCAL_PANTALLAS_6 = {
  // DUEÑO-ANULAR: los dos pasos y los botones. El botón final se llama como la pantalla.
  "fiscal.pantalla.anular_paso_que": {
    porDefecto: "Qué anular",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-anulacion.ts",
        nombre: "armarLaVista",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.anular_paso_motivo": {
    porDefecto: "Motivo y revisar",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-anulacion.ts",
        nombre: "armarLaVista",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.anular_cancelar": {
    porDefecto: "Cancelar",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-anulacion.ts",
        nombre: "armarLaVista",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.anular_siguiente": {
    porDefecto: "Siguiente",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-anulacion.ts",
        nombre: "armarLaVista",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "vistaDeLosPasos",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.anular_volver": {
    porDefecto: "Volver",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-anulacion.ts",
        nombre: "armarLaVista",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "vistaDeLosPasos",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.anular_boton_final": {
    porDefecto: "Anular comprobante",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-anulacion.ts",
        nombre: "armarLaVista",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.anular_enviando": {
    porDefecto: "Anulando…",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-anulacion.ts",
        nombre: "armarLaVista",
      },
    ],
    fuente: "HEREDADO",
  },
  // DUEÑO-ANULAR (paso 1): «Se anula el total», «Anular solo una parte», «Elegí qué anular», «A anular», «Anular el total» y «Total
  // de la factura» (también en el paso 2).
  "fiscal.pantalla.anular_se_anula_el_total": {
    porDefecto: "Se anula el total",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-anulacion.ts",
        nombre: "armarLaVista",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.anular_solo_una_parte": {
    porDefecto: "Anular solo una parte",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-anulacion.ts",
        nombre: "armarLaVista",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.anular_elegi": {
    porDefecto: "Elegí qué anular",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-anulacion.ts",
        nombre: "armarLaVista",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.anular_a_anular": {
    porDefecto: "A anular",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-anulacion.ts",
        nombre: "armarLaVista",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.anular_el_total": {
    porDefecto: "Anular el total",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-anulacion.ts",
        nombre: "armarLaVista",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.anular_total_de_la_factura": {
    porDefecto: "Total de la factura",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-anulacion.ts",
        nombre: "armarLaVista",
      },
    ],
    fuente: "HEREDADO",
  },
  // DUEÑO-ANULAR (paso 1, solo una parte; D-69, D-71): «Facturado» y el campo de cada alícuota, y en letra C el campo único
  // «Importe a anular» (ARCA no recibe alícuotas en la letra C). El aviso (D-72) no bloquea: «El importe supera lo facturado con
  // IVA 10,5 %.», con la tasa que corresponda.
  "fiscal.pantalla.anular_facturado": {
    porDefecto: "Facturado",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-anulacion.ts",
        nombre: "filasParaEscribir",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.anular_importe_con_iva": {
    porDefecto: "Importe a anular (con IVA incluido)",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-anulacion.ts",
        nombre: "filasParaEscribir",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.anular_importe": {
    porDefecto: "Importe a anular",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-anulacion.ts",
        nombre: "filasParaEscribir",
      },
    ],
    fuente: "HEREDADO",
  },
  // Aprobados por el dueño el 2026-10-29 (cuestionario en la sesión web del carril web): el nombre de la fila de una alícuota sin
  // IVA, «Exento» y «No gravado» (una fila por tipo); el aviso de la letra C, «El importe supera lo facturado.» (sin bloqueo, D-72);
  // y, al anular una nota de débito, el rótulo «Total de la nota de débito» (en factura sigue «Total de la factura»).
  // «Exento» y «No gravado» NO figuran en la grabación `014-FEParamGetTiposIva` (solo trae 0, 10.5, 21, 27, 5 y 2.5 %): su fuente es esta aprobación.
  "fiscal.pantalla.anular_alicuota_exento": {
    porDefecto: "Exento",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/impresion/modelo-de-la-hoja.ts",
        nombre: "totalesDe",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-anulacion.ts",
        nombre: "nombreDeLaFila",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.anular_alicuota_no_gravado": {
    porDefecto: "No gravado",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/impresion/modelo-de-la-hoja.ts",
        nombre: "totalesDe",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-anulacion.ts",
        nombre: "nombreDeLaFila",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.anular_aviso_supera_c": {
    porDefecto: "El importe supera lo facturado.",
    largoMaximo: 120,
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-anulacion.ts",
        nombre: "filasParaEscribir",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.anular_total_de_la_nota_de_debito": {
    porDefecto: "Total de la nota de débito",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-anulacion.ts",
        nombre: "armarLaVista",
      },
    ],
    fuente: "HEREDADO",
  },
  "fiscal.pantalla.anular_aviso_supera": {
    porDefecto: "El importe supera lo facturado con IVA {alicuota} %.",
    largoMaximo: 120,
    marcadores: ["alicuota"],
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-anulacion.ts",
        nombre: "filasParaEscribir",
      },
    ],
    fuente: "HEREDADO",
  },
} as const;
