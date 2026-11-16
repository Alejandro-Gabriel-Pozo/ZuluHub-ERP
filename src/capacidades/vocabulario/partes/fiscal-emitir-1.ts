/** Parte 1 de 2 de `TEXTOS_DE_FISCAL_EMITIR` (`catalogo-fiscal-emitir.ts`, que la reexporta): se partió para no pasar del tope de líneas. Ninguna clave ni texto cambió. */
export const TEXTOS_DE_FISCAL_EMITIR_1 = {
  // PROTO-8B (figura en el prototipo aprobado, artboard «8 · Emitir una factura», columna «B · Por pasos»): el encabezado «Emitir factura»; CONTRATO, pantalla 3: el botón final «Emitir factura» (el mismo texto).
  "fiscal.pantalla.emitir_titulo": {
    porDefecto: "Emitir factura",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/app/s/app/(operacion)/facturacion/comprobantes/emitir/page.tsx",
        nombre: "OPCIONES",
      },
      {
        como: "FUNCION",
        archivo:
          "apps/web/app/s/app/(operacion)/facturacion/comprobantes/emitir/venta/[ticketId]/page.tsx",
        nombre: "OPCIONES",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "vistaDeLosPasos",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/pruebas/ayudas-de-emision.tsx",
        nombre: "enArmazon",
      },
    ],
    fuente: "HEREDADO",
  },
  // PROTO-8B (figura en el prototipo aprobado; no cambiar «Revisar»): el tercer paso, «3 Revisar» (los pasos 1 y 2 son «Cliente» y «Renglones», que ya existen).
  "fiscal.pantalla.emitir_paso_revisar": {
    porDefecto: "Revisar",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "vistaDeLosPasos",
      },
    ],
    fuente: "HEREDADO",
  },
  // PROTO-8B (figura en el prototipo aprobado; no cambiar «Revisá y emití»): el título del último paso, «Revisá y emití».
  "fiscal.pantalla.emitir_revisa_y_emiti": {
    porDefecto: "Revisá y emití",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision-de-un-ticket.ts",
        nombre: "vistaDeLaRevisionDeUnTicket",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "vistaDeLaRevision",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-11-04, aprobado tal cual (D-95; chat de la sesión web). Origen: el prototipo viejo EMITIR-HTML, línea 37.
  "fiscal.pantalla.emitir_agregar_renglon": {
    porDefecto: "+ Agregar renglón",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "vistaDeLosRenglones",
      },
    ],
    fuente: "HEREDADO",
  },
  // CONTRATO, pantalla 1, «Acciones»: «+ Emitir» abre Emitir (`comprobantes.emitir_manual`).
  // D-93 / D-95 (Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`, 2026-11-03), punto 7: NO se muestra cuando la persona no puede emitir.
  "fiscal.pantalla.listado_emitir": {
    porDefecto: "+ Emitir",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-del-listado.ts",
        nombre: "enlaceDeEmitir",
      },
    ],
    fuente: "HEREDADO",
  },

  // EMITIR-HTML, línea 29: «Descripción».
  // D-93 / D-95 (Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`, 2026-11-03), punto 2: rótulos aprobados tal cual.
  "fiscal.pantalla.emitir_descripcion": {
    porDefecto: "Descripción",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/impresion/modelo-de-la-hoja.ts",
        nombre: "columnasDe",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "vistaDeLosRenglones",
      },
    ],
    fuente: "HEREDADO",
  },
  // EMITIR-HTML, línea 31: «Cantidad».
  // D-93 / D-95 (Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`, 2026-11-03), punto 2: rótulos aprobados tal cual.
  "fiscal.pantalla.emitir_cantidad": {
    porDefecto: "Cantidad",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/impresion/modelo-de-la-hoja.ts",
        nombre: "columnasDe",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "vistaDeLosRenglones",
      },
    ],
    fuente: "HEREDADO",
  },
  // EMITIR-HTML, línea 32: «Precio con IVA» (D-85: el precio de cada renglón es con IVA incluido).
  // D-93 / D-95 (Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`, 2026-11-03), punto 2: rótulos aprobados tal cual.
  "fiscal.pantalla.emitir_precio_con_iva": {
    porDefecto: "Precio con IVA",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/impresion/modelo-de-la-hoja.ts",
        nombre: "columnasDe",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "vistaDeLosRenglones",
      },
    ],
    fuente: "HEREDADO",
  },
  // EMITIR-HTML, línea 34: «IVA» (la alícuota del renglón).
  // D-93 / D-95 (Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`, 2026-11-03), punto 2: rótulos aprobados tal cual.
  "fiscal.pantalla.emitir_iva": {
    porDefecto: "IVA",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/impresion/modelo-de-la-hoja.ts",
        nombre: "columnasDe",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "vistaDeLosRenglones",
      },
    ],
    fuente: "HEREDADO",
  },
  // RECEPTOR-HTML, línea 20: «Nombre o razón social» (D-24: el receptor se escribe a mano).
  // D-93 / D-95 (Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`, 2026-11-03), punto 2: rótulos aprobados tal cual.
  "fiscal.pantalla.emitir_nombre": {
    porDefecto: "Nombre o razón social",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "vistaDelCliente",
      },
    ],
    fuente: "HEREDADO",
  },

  // D-93 / D-95 (Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`, 2026-11-03), punto 4: «Precio» donde la empresa no discrimina IVA (D-85: en letra C solo vale IVA incluido); como «Importe a anular» de D-75.
  "fiscal.pantalla.emitir_precio": {
    porDefecto: "Precio",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/impresion/modelo-de-la-hoja.ts",
        nombre: "columnasDe",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "vistaDeLosRenglones",
      },
    ],
    fuente: "HEREDADO",
  },
  // D-93 / D-95 (Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`, 2026-11-03), punto 4: «Renglón {numero}» nombra cada grupo de campos (el lector de pantalla los distingue); la palabra es la de la guía `06-facturador-pantallas-y-mensajes.md`, §4.2, líneas 153 a 156.
  "fiscal.pantalla.emitir_renglon_numero": {
    porDefecto: "Renglón {numero}",
    marcadores: ["numero"],
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "vistaDeLosRenglones",
      },
    ],
    fuente: "HEREDADO",
  },
  // D-93 / D-95 (Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`, 2026-11-03), punto 4: se pueden quitar renglones («Quitar renglón {numero}»).
  "fiscal.pantalla.emitir_quitar_renglon": {
    porDefecto: "Quitar renglón {numero}",
    marcadores: ["numero"],
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "vistaDeLosRenglones",
      },
    ],
    fuente: "HEREDADO",
  },
  // D-93 / D-95 (Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`, 2026-11-03), punto 4: la opción de un punto de venta de pruebas, «00002 · Pruebas» (D-87 pide marcarlo con `config_pv_pruebas`); la plantilla es el punto 4 de D-93, «{número} · Pruebas» (la usa `etiquetaDelPunto`).
  "fiscal.pantalla.emitir_punto_de_venta_con_marca": {
    porDefecto: "{numero} · {marca}",
    marcadores: ["marca", "numero"],
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "etiquetaDelPunto",
      },
    ],
    fuente: "HEREDADO",
  },

  // D-93 / D-95 (Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`, 2026-11-03), punto 3: se ofrecen las 11. ARCA-016, Id 1: «IVA Responsable Inscripto» (igual a D-44, `opciones-de-datos-fiscales.ts`, en `composicion/`, que esta pantalla no puede importar).
  "fiscal.pantalla.emitir_condicion_responsable_inscripto": {
    porDefecto: "IVA Responsable Inscripto",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "CLAVE_DE_CONDICION",
      },
    ],
    fuente: "HEREDADO",
  },
  // D-93 / D-95 (Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`, 2026-11-03), punto 3: se ofrecen las 11. ARCA-016, Id 6: «Responsable Monotributo» (igual a D-44).
  "fiscal.pantalla.emitir_condicion_monotributo": {
    porDefecto: "Responsable Monotributo",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "CLAVE_DE_CONDICION",
      },
    ],
    fuente: "HEREDADO",
  },
  // D-93 / D-95 (Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`, 2026-11-03), punto 3: se ofrecen las 11. ARCA-016, Id 13: «Monotributista Social».
  "fiscal.pantalla.emitir_condicion_monotributista_social": {
    porDefecto: "Monotributista Social",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "CLAVE_DE_CONDICION",
      },
    ],
    fuente: "HEREDADO",
  },
  // D-93 / D-95 (Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`, 2026-11-03), punto 3: se ofrecen las 11. ARCA-016, Id 16: «Monotributo Trabajador Independiente Promovido».
  "fiscal.pantalla.emitir_condicion_monotributo_promovido": {
    porDefecto: "Monotributo Trabajador Independiente Promovido",
    largoMaximo: 120,
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "CLAVE_DE_CONDICION",
      },
    ],
    fuente: "HEREDADO",
  },
  // D-93 / D-95 (Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`, 2026-11-03), punto 3: se ofrecen las 11. ARCA-016, Id 4: «IVA Sujeto Exento» (igual a D-44).
  "fiscal.pantalla.emitir_condicion_exento": {
    porDefecto: "IVA Sujeto Exento",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "CLAVE_DE_CONDICION",
      },
    ],
    fuente: "HEREDADO",
  },
  // D-93 / D-95 (Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`, 2026-11-03), punto 3: se ofrecen las 11. ARCA-016, Id 7: «Sujeto No Categorizado».
  "fiscal.pantalla.emitir_condicion_no_categorizado": {
    porDefecto: "Sujeto No Categorizado",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "CLAVE_DE_CONDICION",
      },
    ],
    fuente: "HEREDADO",
  },
  // D-93 / D-95 (Pedernal-docs, `11-especificaciones/facturador-contratos-de-pantalla.md`, 2026-11-03), punto 3: se ofrecen las 11. ARCA-016, Id 8: «Proveedor del Exterior».
  "fiscal.pantalla.emitir_condicion_proveedor_del_exterior": {
    porDefecto: "Proveedor del Exterior",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/facturacion/modelo-de-emision.ts",
        nombre: "CLAVE_DE_CONDICION",
      },
    ],
    fuente: "HEREDADO",
  },
} as const;
