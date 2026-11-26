/**
 * Los textos de las pantallas de notas del proveedor (prefijo `compras.`, NOTAS-2c-1): «Notas de la factura», «Cargar una nota del proveedor» y el estado de la factura con notas. Son los títulos y rótulos de las
 * pantallas 9 y 10 de la maqueta de Diseño 2 (`servicios-y-bienes-de-uso.html`, 25/11/2026); las etiquetas simples las aceptó el orquestador por delegación del 15/11 (fila 173) en DEC-COM-012; los dos rótulos que tocan
 * dinero («Importe a pagar», «Todavía se puede acreditar») están en DEC-COM-013 (aprobados por el dueño el 26/11/2026); lo que el dueño confirmó el 26/11/2026 (filas 12, 14 y 15) está en DEC-COM-014. Va en su archivo porque
 * `catalogo-compras.ts` está en el tope de 400 líneas. Sus demás textos («Nota de crédito», «Nota de débito», «Cargar nota de crédito», «Tipo», «Anulada», «Guardar», «Cancelar») ya existen y se reutilizan.
 */
const USO_DE_LAS_NOTAS = [
  {
    como: "FUNCION",
    archivo: "apps/web/ui/plantillas/compras/notas/textos-de-notas.ts",
    nombre: "textosDeNotas",
  },
] as const;

export const TEXTOS_DE_COMPRAS_NOTAS = {
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
} as const;
