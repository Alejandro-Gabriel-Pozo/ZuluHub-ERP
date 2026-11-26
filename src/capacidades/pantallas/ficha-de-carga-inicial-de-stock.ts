import type { FichaDePantalla } from "./ficha-de-mesas";

/**
 * LA FICHA DE LA PANTALLA «CARGA INICIAL» DE STOCK (STK-C, FP-STK-08 y FP-STK-09; DDD:174: toda pantalla tiene su ficha). La grilla carga el stock de arranque de UN depósito (de uso Normal) en una sola tanda,
 * todo o nada y con clave de idempotencia por gesto; cada fila lleva artículo, cantidad y costo por unidad opcional, con su valor (informativo). Es una pantalla armada con ayudas: el servidor valida cada renglón
 * y decide. «Registrar» sale apagado sin el permiso (`stock.registrar_entrada` y además `stock.ajustar`, DEC-STK-004; el servidor igual decide). Corregir una carga es «Anular» desde Movimientos (FP-STK-09: no es una
 * pantalla nueva). Sin lote ni vencimiento por renglón (STK-E). Previene: un botón o un texto que nadie aprobó, o un importe que el servidor no calcula presentado como definitivo.
 */

const CARGA_APROBADA = {
  decidio:
    "el dueño, 25/11/2026 (fila 449: N-02, N-04 a N-08) y el orquestador por delegación del dueño (fila 173: N-03); DEC-STK-003",
  donde:
    "arquitectura/decisiones/registro/DEC-STK-003.json; Pedernal-docs 11-especificaciones/dia-uno-stock-inventario-de-textos-2026-11-25.md (N-02 a N-08)",
} as const;
const MAQUETA_DE_STOCK = {
  decidio:
    "el dueño, 09/11/2026 (aprobó la tabla «Textos nuevos» de la maqueta `stock.html`; decisión D125 de Pedernal-docs 11-especificaciones/decisiones-del-dueno-2026-11.md)",
  donde:
    "Pedernal-docs 10-ux-ui, maqueta stock.html (tabla «Textos nuevos», filas «Pantallas», «Acciones», «Motivos» y «Errores y avisos»)",
} as const;
const ARTICULO_DE_MOVIMIENTOS = {
  decidio:
    "el dueño, 25/11/2026 (fila 449) y el orquestador por delegación del dueño (fila 173); DEC-STK-001",
  donde: "arquitectura/decisiones/registro/DEC-STK-001.json",
} as const;
const YA_APROBADO = {
  decidio:
    "el dueño, 09/11/2026 y 12/11/2026 (maqueta de productos aprobada); por delegación (fila 173) el orquestador acepta los textos ya aprobados",
  donde: "Pedernal-docs 11-especificaciones/dia-uno-stock-inventario-de-textos-2026-11-25.md §1.7",
} as const;
const USO = "FormularioDeCargaInicial.cliente.tsx";

export const FICHA_DE_CARGA_INICIAL_DE_STOCK = {
  archivos: [
    "apps/web/app/s/app/(operacion)/stock/carga-inicial/page.tsx",
    "apps/web/pantallas/pantalla-de-carga-inicial.tsx",
    "apps/web/ui/plantillas/stock/carga-inicial/FormularioDeCargaInicial.cliente.tsx",
    "apps/web/ui/plantillas/stock/carga-inicial/modelo-de-carga-inicial.ts",
  ],
  rutas: ["/stock/carga-inicial"],
  titulo: "stock.motivo.carga_inicial",
  acceso: "stock.ver",
  botones: [
    {
      id: "registrar",
      texto: "stock.accion.registrar",
      hace: { envia: "stock.registrar_entrada" },
      sinPermiso: "APAGADO",
    },
  ],
  estados: { ERROR: "GENERICO", SIN_PERMISO: "GENERICO" },
  textos: {
    "stock.motivo.carga_inicial": {
      usos: ["título de la pantalla y botón de Existencias que lleva a ella"],
      fuente: MAQUETA_DE_STOCK,
    },
    "stock.pantalla.depositos": {
      usos: [USO + " (rótulo del depósito de la tanda)"],
      fuente: MAQUETA_DE_STOCK,
    },
    "stock.accion.articulo": {
      usos: [USO + " (rótulo de cada fila)"],
      fuente: ARTICULO_DE_MOVIMIENTOS,
    },
    "stock.accion.cantidad": { usos: [USO], fuente: MAQUETA_DE_STOCK },
    "stock.accion.costo_por_unidad": { usos: [USO], fuente: MAQUETA_DE_STOCK },
    "catalogo.campo.opcional": { usos: [USO + " (ayuda del costo)"], fuente: YA_APROBADO },
    "stock.accion.registrar": { usos: [USO + " (botón)"], fuente: MAQUETA_DE_STOCK },
    "catalogo.accion.cancelar": { usos: [USO], fuente: YA_APROBADO },
    "catalogo.accion.quitar": { usos: [USO + " (botón de cada fila)"], fuente: YA_APROBADO },
    "stock.error.cantidad_invalida": {
      usos: [USO + " (marca de la fila con una cantidad que no sirve)"],
      fuente: MAQUETA_DE_STOCK,
    },
    "stock.error.sin_permiso": { usos: ["todo otro rechazo"], fuente: MAQUETA_DE_STOCK },
    "stock.carga.valor": { usos: [USO + " (valor de cada fila)"], fuente: CARGA_APROBADA },
    "stock.carga.agregar_articulo": { usos: [USO + " (botón)"], fuente: CARGA_APROBADA },
    "stock.carga.resumen": { usos: [USO + " (artículos y valor total)"], fuente: CARGA_APROBADA },
    "stock.carga.es_de_hoy": { usos: [USO + " (aviso)"], fuente: CARGA_APROBADA },
    "stock.carga.revisar_costo": {
      usos: [USO + " (marca de la fila con un costo que no sirve)"],
      fuente: CARGA_APROBADA,
    },
    "stock.carga.ya_hay_existencia": {
      usos: [
        "aviso cuando el depósito ya tiene existencia: el próximo «Registrar» confirma con la misma clave",
      ],
      fuente: CARGA_APROBADA,
    },
    "stock.carga.sin_costo": {
      usos: [USO + " (cuántas filas van sin costo)"],
      fuente: CARGA_APROBADA,
    },
  },
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDePantalla;
