const USO_DEL_REEMPLAZO = [
  {
    como: "FUNCION",
    archivo: "apps/web/ui/plantillas/compras/reemplazo/textos-de-reemplazo.ts",
    nombre: "textosDeReemplazo",
  },
] as const;

const USO_DE_LAS_NOTAS = [
  {
    como: "FUNCION",
    archivo: "apps/web/ui/plantillas/compras/notas/textos-de-notas.ts",
    nombre: "textosDeNotas",
  },
] as const;

/**
 * El texto de «Tomar el costo de la factura» (prefijo `compras.`, Compras 4, PR C). Es el botón y el título de la hoja que toma el costo de una línea recibida de la factura que la cubre; lo aprobó el dueño
 * el 25/11/2026 (pregunta 2 de Compras 4, «b chica»; DEC-0903). Va en su archivo porque `catalogo-compras.ts` está en el tope de 400 líneas (hallazgo: ese tope obliga a abrir una parte nueva por cada
 * texto que se agregue al módulo). Sus demás textos («Precio neto», «Cancelar», «Cerrar») ya existen y se reutilizan. También lleva los textos de las notas del proveedor (NOTAS-2c-1), porque `catalogo.ts` está en su tope de líneas y no admite otra parte.
 */
export const TEXTOS_DE_COMPRAS_COSTO = {
  "compras.factura.tomar_costo": {
    porDefecto: "Tomar el costo de la factura",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/compras/facturas/textos-de-facturas.ts",
        nombre: "textosDeFacturas",
      },
    ],
    fuente: { decision: "DEC-0903" },
  },
  // Las pantallas de notas del proveedor (NOTAS-2c-1): títulos y rótulos de las pantallas 9 y 10 de la maqueta de Diseño 2; DEC-COM-012 (etiquetas simples, aceptadas por el orquestador), DEC-COM-013 (rótulos de dinero, aprobados por el dueño el 26/11/2026) y DEC-COM-014 (textos confirmados por el dueño el 26/11/2026).
  "compras.notas.titulo": {
    porDefecto: "Notas de la factura",
    usos: USO_DE_LAS_NOTAS,
    fuente: { decision: "DEC-COM-012" },
  },
  "compras.notas.cargar_titulo": {
    porDefecto: "Cargar una nota del proveedor",
    usos: USO_DE_LAS_NOTAS,
    fuente: { decision: "DEC-COM-012" },
  },
  "compras.notas.total_de_la_factura": {
    porDefecto: "Total de la factura",
    usos: USO_DE_LAS_NOTAS,
    fuente: { decision: "DEC-COM-012" },
  },
  "compras.notas.creditos_vigentes": {
    porDefecto: "Notas de crédito vigentes",
    usos: USO_DE_LAS_NOTAS,
    fuente: { decision: "DEC-COM-012" },
  },
  "compras.notas.debitos_vinculados": {
    porDefecto: "Notas de débito vinculadas",
    usos: USO_DE_LAS_NOTAS,
    fuente: { decision: "DEC-COM-012" },
  },
  "compras.notas.cargar_nota_de_debito": {
    porDefecto: "Cargar nota de débito",
    usos: USO_DE_LAS_NOTAS,
    fuente: { decision: "DEC-COM-012" },
  },
  "compras.notas.vigente": {
    porDefecto: "Vigente",
    usos: USO_DE_LAS_NOTAS,
    fuente: { decision: "DEC-COM-012" },
  },
  "compras.notas.total_de_la_nota": {
    porDefecto: "Total de la nota",
    usos: USO_DE_LAS_NOTAS,
    fuente: { decision: "DEC-COM-012" },
  },
  "compras.notas.importe_a_pagar": {
    porDefecto: "Importe a pagar",
    usos: USO_DE_LAS_NOTAS,
    fuente: { decision: "DEC-COM-013" },
  },
  "compras.notas.todavia_se_puede_acreditar": {
    porDefecto: "Todavía se puede acreditar",
    usos: USO_DE_LAS_NOTAS,
    fuente: { decision: "DEC-COM-013" },
  },
  "compras.notas.saldada_por_notas": {
    porDefecto: "Saldada por notas",
    usos: [
      ...USO_DE_LAS_NOTAS,
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/compras/textos-de-compras.ts",
        nombre: "textosDeCompras",
      },
    ],
    fuente: { decision: "DEC-COM-014" },
  },
  "compras.notas.saldo_a_favor": {
    porDefecto: "Saldo a favor",
    usos: USO_DE_LAS_NOTAS,
    fuente: { decision: "DEC-COM-014" },
  },
  "compras.error.nota_con_pago": {
    porDefecto: "Primero anulá el pago: se pagó con esta nota descontada",
    usos: [
      {
        como: "FUNCION",
        archivo: "src/capacidades/experiencia/respuesta-de-compras.ts",
        nombre: "CLAVES_DE_ERRORES_DE_COMPRAS",
      },
    ],
    fuente: { decision: "DEC-COM-014" },
  },
  // «Reemplazar el comprobante» (NOTAS-2c-2, pantalla 11): títulos y rótulos aceptados por el orquestador (DEC-COM-015, fila 173); el motivo precargado y el aviso del costo del stock son del dueño (DEC-COM-016, P-1 del 26/11/2026).
  "compras.reemplazo.titulo": {
    porDefecto: "Reemplazar el comprobante",
    usos: USO_DEL_REEMPLAZO,
    fuente: { decision: "DEC-COM-015" },
  },
  "compras.reemplazo.que_deshacer_antes": {
    porDefecto: "Qué hay que deshacer antes",
    usos: USO_DEL_REEMPLAZO,
    fuente: { decision: "DEC-COM-015" },
  },
  "compras.reemplazo.comprobante_nuevo": {
    porDefecto: "Comprobante nuevo",
    usos: USO_DEL_REEMPLAZO,
    fuente: { decision: "DEC-COM-015" },
  },
  "compras.reemplazo.cambiar_comprobante": {
    porDefecto: "Cambiar el comprobante de la compra",
    usos: [
      ...USO_DEL_REEMPLAZO,
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/compras/textos-de-compras.ts",
        nombre: "textosDeCompras",
      },
    ],
    fuente: { decision: "DEC-COM-015" },
  },
  "compras.reemplazo.pago": {
    porDefecto: "Pago",
    usos: USO_DEL_REEMPLAZO,
    fuente: { decision: "DEC-COM-015" },
  },
  "compras.reemplazo.motivo_por_defecto": {
    porDefecto: "Reemplazada por la factura {numero}",
    marcadores: ["numero"],
    usos: USO_DEL_REEMPLAZO,
    fuente: { decision: "DEC-COM-016" },
  },
  "compras.reemplazo.costo_no_cambia": {
    porDefecto: "El costo del stock no cambia; si hace falta, usá Corregir lo recibido",
    usos: USO_DEL_REEMPLAZO,
    fuente: { decision: "DEC-COM-016" },
  },
} as const;
