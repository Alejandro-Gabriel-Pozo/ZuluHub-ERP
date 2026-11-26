import type { FichaDePantalla } from "./ficha-de-mesas";

/**
 * LA FICHA DE LA PESTAÑA «LOTES» DE STOCK (STK-E, lectura; FP-STK-13 y FP-STK-14; DDD:174: toda pantalla tiene su ficha). Declara lo que la pantalla ofrece: ruta y archivos, el acceso, los botones, los estados y cada
 * texto con SU uso y SU fuente. Misma forma que `ficha-de-mesas.ts` y la comprueba `ficha-de-existencias-y-movimientos.test.ts` contra el catálogo de textos. Escritura (STK-E1): «Controlar por lote» (solo con la perilla `lotes` del plan: sin ella no hay botón) o «Dejar de controlar» según el artículo, «Corregir» en cada lote con fechas y «Reasignar» en el «Sin asignar» con existencia
 * (los dos llevan a su pantalla, ver `ficha-de-corregir-y-reasignar-lote.ts`); salen apagados sin el permiso y el servidor igual decide. Sin importes (la maqueta no los muestra). Los artículos y los horizontes de Vencimientos se eligen con enlaces; la sucursal la fija el servidor.
 * Previene: un botón o un texto que nadie aprobó, o un importe que la maqueta no pidió.
 */

const LOTES_APROBADOS = {
  decidio:
    "el dueño, 25/11/2026 (fila 449: «Lotes» como quinta pestaña) y el orquestador por delegación del dueño (fila 173) para los demás rótulos; DEC-STK-002",
  donde:
    "arquitectura/decisiones/registro/DEC-STK-002.json; Pedernal-docs 11-especificaciones/dia-uno-stock-inventario-de-textos-2026-11-25.md (L-01, L-03, L-04, L-10, L-11, L-12, L-16) y maqueta stock-lotes.html",
} as const;
const ESCRITURA_APROBADA = {
  decidio:
    "el dueño, 25/11/2026 (fila 449: L-05 a L-08 y L-15) y el orquestador por delegación del dueño (fila 173: L-09); DEC-STK-005",
  donde:
    "arquitectura/decisiones/registro/DEC-STK-005.json; Pedernal-docs 11-especificaciones/dia-uno-stock-inventario-de-textos-2026-11-25.md (L-05 a L-09 y L-15)",
} as const;
const MAQUETA_DE_STOCK = {
  decidio:
    "el dueño, 09/11/2026 (aprobó la tabla «Textos nuevos» de la maqueta `stock.html`; decisión D125 de Pedernal-docs 11-especificaciones/decisiones-del-dueno-2026-11.md)",
  donde: "Pedernal-docs 10-ux-ui, maqueta stock.html (tabla «Textos nuevos», fila «Pantallas»)",
} as const;
const ARTICULO_DE_MOVIMIENTOS = {
  decidio:
    "el dueño, 25/11/2026 (fila 449) y el orquestador por delegación del dueño (fila 173); DEC-STK-001",
  donde: "arquitectura/decisiones/registro/DEC-STK-001.json",
} as const;
const USO_DE_LA_PANTALLA = "PantallaDeLotes.tsx";

export const FICHA_DE_LOTES_DE_STOCK = {
  archivos: [
    "apps/web/app/s/app/(operacion)/stock/lotes/page.tsx",
    "apps/web/ui/plantillas/stock/lotes/PantallaDeLotes.tsx",
    "apps/web/ui/plantillas/stock/lotes/modelo-de-lotes.ts",
    "apps/web/ui/plantillas/stock/lectura/SelectorDeDeposito.tsx",
  ],
  rutas: ["/stock/lotes"],
  titulo: "stock.lotes.pantalla",
  acceso: "lotes.ver",
  botones: [
    {
      id: "controlar",
      texto: "stock.lotes.controlar",
      hace: { envia: "lotes.controlar" },
      sinPermiso: "APAGADO",
    },
    {
      id: "dejar-de-controlar",
      texto: "stock.lotes.dejar_de_controlar",
      hace: { envia: "lotes.dejar_de_controlar" },
      sinPermiso: "APAGADO",
    },
    {
      id: "corregir",
      texto: "stock.lotes.corregir",
      hace: { navega: "/stock/lotes/corregir" },
      sinPermiso: "APAGADO",
    },
    {
      id: "reasignar",
      texto: "stock.lotes.reasignar",
      hace: { navega: "/stock/lotes/reasignar" },
      sinPermiso: "APAGADO",
    },
  ],
  estados: { ERROR: "GENERICO", SIN_PERMISO: "GENERICO" },
  textos: {
    "stock.lotes.controlar": {
      usos: ["page.tsx (botón; solo con la perilla `lotes` y si el artículo no se controla)"],
      fuente: ESCRITURA_APROBADA,
    },
    "stock.lotes.dejar_de_controlar": {
      usos: ["page.tsx (botón; si el artículo ya se controla)"],
      fuente: ESCRITURA_APROBADA,
    },
    "stock.lotes.corregir": {
      usos: [USO_DE_LA_PANTALLA + " (botón de cada lote con fechas)"],
      fuente: ESCRITURA_APROBADA,
    },
    "stock.lotes.reasignar": {
      usos: [USO_DE_LA_PANTALLA + " (botón del «Sin asignar» con existencia)"],
      fuente: ESCRITURA_APROBADA,
    },
    "stock.lotes.pantalla": {
      usos: ["título de la pantalla y de la pestaña"],
      fuente: LOTES_APROBADOS,
    },
    "stock.lotes.vence": {
      usos: [USO_DE_LA_PANTALLA + " (vencimiento de cada lote y de cada fila de Vencimientos)"],
      fuente: LOTES_APROBADOS,
    },
    "stock.lotes.sin_asignar": {
      usos: ["modelo-de-lotes.ts (el lote que junta lo que no tiene lote)"],
      fuente: LOTES_APROBADOS,
    },
    "stock.lotes.vencimientos": {
      usos: [USO_DE_LA_PANTALLA + " (enlace y título de la vista de lo que vence)"],
      fuente: LOTES_APROBADOS,
    },
    "stock.lotes.vencido": {
      usos: ["modelo-de-lotes.ts (estado de un lote vencido)"],
      fuente: LOTES_APROBADOS,
    },
    "stock.lotes.vence_hoy": {
      usos: ["modelo-de-lotes.ts (estado de un lote que vence hoy)"],
      fuente: LOTES_APROBADOS,
    },
    "stock.lotes.dias": {
      usos: [
        "modelo-de-lotes.ts (rótulo de cada horizonte de Vencimientos: enlaces a 7, 30 y 90 días; por defecto 7; la dirección acepta solo un entero de 0 a 365, otro valor es el genérico)",
      ],
      fuente: LOTES_APROBADOS,
    },
    "stock.accion.articulo": {
      usos: [
        USO_DE_LA_PANTALLA + " (rótulo del selector de artículos; se reutiliza el de movimientos)",
      ],
      fuente: ARTICULO_DE_MOVIMIENTOS,
    },
    "stock.pantalla.existencia": {
      usos: [USO_DE_LA_PANTALLA + " (rótulo de la existencia de cada lote)"],
      fuente: MAQUETA_DE_STOCK,
    },
    "stock.pantalla.disponible": {
      usos: [USO_DE_LA_PANTALLA + " (rótulo de lo disponible de cada lote)"],
      fuente: MAQUETA_DE_STOCK,
    },
  },
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDePantalla;
