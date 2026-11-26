import type { FichaDePantalla } from "./ficha-de-mesas";

/**
 * LAS FICHAS DE «CORREGIR» Y «REASIGNAR» UN LOTE (STK-E1, FP-STK-16, maqueta `stock-lotes.html`; DDD:174: toda pantalla tiene su ficha). Dos pantallas propias (SUPUESTO S2, aceptado por el orquestador; DEC-STK-005): se llega desde los
 * lotes de un artículo. Corregir cambia la fecha de vencimiento con su motivo y la VERSIÓN que se vio (si otra persona lo corrigió antes, no se pisa y la pantalla recarga); Reasignar mueve existencia del «Sin asignar» a un lote
 * que ya existe, en un depósito, con su motivo y una clave por gesto (el mismo clic repetido es una sola reasignación); no toca el libro ni mueve valor. Misma forma que `ficha-de-mesas.ts`; las comprueba
 * `ficha-de-existencias-y-movimientos.test.ts`. Previene: un botón o un texto que nadie aprobó, o un lote creado desde una pantalla que solo reparte existencia.
 */

const ESCRITURA_APROBADA = {
  decidio:
    "el dueño, 25/11/2026 (fila 449: L-05 a L-08 y L-15) y el orquestador por delegación del dueño (fila 173: L-09); DEC-STK-005",
  donde:
    "arquitectura/decisiones/registro/DEC-STK-005.json; Pedernal-docs 11-especificaciones/dia-uno-stock-inventario-de-textos-2026-11-25.md (L-05 a L-09 y L-15)",
} as const;
const MAQUETA_DE_STOCK = {
  decidio:
    "el dueño, 09/11/2026 (aprobó la tabla «Textos nuevos» de la maqueta `stock.html`; decisión D125 de Pedernal-docs 11-especificaciones/decisiones-del-dueno-2026-11.md)",
  donde:
    "Pedernal-docs 10-ux-ui, maqueta stock.html (tabla «Textos nuevos», filas «Pantallas», «Acciones», «Motivos» y «Errores y avisos»)",
} as const;
const CONTROL_APROBADO = {
  decidio:
    "el dueño, 09/11/2026 (aprobó la tabla «Textos nuevos» de la maqueta `control.html`; decisión D118)",
  donde:
    "Pedernal-docs 10-ux-ui prototipos-gastronomia, control.html (tabla «Textos nuevos», fila «Recibir»)",
} as const;
const YA_APROBADO = {
  decidio:
    "el dueño, 09/11/2026 y 12/11/2026 (maqueta de productos aprobada); por delegación (fila 173) el orquestador acepta los textos ya aprobados",
  donde: "Pedernal-docs 11-especificaciones/dia-uno-stock-inventario-de-textos-2026-11-25.md §1.7",
} as const;

export const FICHA_DE_CORREGIR_LOTE = {
  archivos: [
    "apps/web/app/s/app/(operacion)/stock/lotes/corregir/page.tsx",
    "apps/web/ui/plantillas/stock/lotes/FormularioDeCorregirLote.cliente.tsx",
  ],
  rutas: ["/stock/lotes/corregir"],
  titulo: "stock.lotes.pantalla",
  acceso: "lotes.corregir",
  botones: [
    {
      id: "guardar",
      texto: "catalogo.accion.guardar",
      hace: { envia: "lotes.corregir" },
      sinPermiso: "APAGADO",
    },
    {
      id: "cancelar",
      texto: "catalogo.accion.cancelar",
      hace: { navega: "/stock/lotes" },
      sinPermiso: "APAGADO",
    },
  ],
  estados: { ERROR: "GENERICO", SIN_PERMISO: "GENERICO" },
  textos: {
    "stock.lotes.pantalla": {
      usos: ["título de la pantalla y de la pestaña"],
      fuente: {
        ...MAQUETA_DE_STOCK,
        decidio: "el dueño, 25/11/2026 (fila 449: «Lotes» como quinta pestaña); DEC-STK-002",
        donde: "arquitectura/decisiones/registro/DEC-STK-002.json",
      },
    },
    "stock.lotes.fecha_de_vencimiento": {
      usos: ["FormularioDeCorregirLote.cliente.tsx (rótulo del campo)"],
      fuente: ESCRITURA_APROBADA,
    },
    "stock.accion.detalle": {
      usos: ["FormularioDeCorregirLote.cliente.tsx (por qué se corrige; obligatorio)"],
      fuente: MAQUETA_DE_STOCK,
    },
    "catalogo.accion.guardar": {
      usos: ["FormularioDeCorregirLote.cliente.tsx (botón)"],
      fuente: YA_APROBADO,
    },
    "catalogo.accion.cancelar": {
      usos: ["FormularioDeCorregirLote.cliente.tsx (vuelve a los lotes)"],
      fuente: YA_APROBADO,
    },
  },
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDePantalla;

export const FICHA_DE_REASIGNAR_LOTE = {
  archivos: [
    "apps/web/app/s/app/(operacion)/stock/lotes/reasignar/page.tsx",
    "apps/web/ui/plantillas/stock/lotes/FormularioDeReasignarLote.cliente.tsx",
  ],
  rutas: ["/stock/lotes/reasignar"],
  titulo: "stock.lotes.pantalla",
  acceso: "lotes.reasignar",
  botones: [
    {
      id: "registrar",
      texto: "stock.accion.registrar",
      hace: { envia: "lotes.reasignar" },
      sinPermiso: "APAGADO",
    },
    {
      id: "cancelar",
      texto: "catalogo.accion.cancelar",
      hace: { navega: "/stock/lotes" },
      sinPermiso: "APAGADO",
    },
  ],
  estados: { ERROR: "GENERICO", SIN_PERMISO: "GENERICO" },
  textos: {
    "stock.lotes.pantalla": {
      usos: ["título de la pantalla y de la pestaña"],
      fuente: {
        ...MAQUETA_DE_STOCK,
        decidio: "el dueño, 25/11/2026 (fila 449: «Lotes» como quinta pestaña); DEC-STK-002",
        donde: "arquitectura/decisiones/registro/DEC-STK-002.json",
      },
    },
    "stock.lotes.sin_asignar": {
      usos: ["modelo-de-lotes.ts (el lote de origen)"],
      fuente: {
        decidio:
          "el orquestador por delegación del dueño (fila 173); DEC-STK-002 (dueño 25/11/2026)",
        donde: "arquitectura/decisiones/registro/DEC-STK-002.json",
      },
    },
    "stock.pantalla.depositos": {
      usos: ["FormularioDeReasignarLote.cliente.tsx (rótulo del depósito)"],
      fuente: MAQUETA_DE_STOCK,
    },
    "lotes.lote.lote": {
      usos: [
        "FormularioDeReasignarLote.cliente.tsx (rótulo del lote de destino, siempre uno que ya existe)",
      ],
      fuente: CONTROL_APROBADO,
    },
    "stock.accion.cantidad": {
      usos: ["FormularioDeReasignarLote.cliente.tsx (cuánto se reasigna; texto decimal exacto)"],
      fuente: MAQUETA_DE_STOCK,
    },
    "stock.accion.detalle": {
      usos: ["FormularioDeReasignarLote.cliente.tsx (motivo; obligatorio)"],
      fuente: MAQUETA_DE_STOCK,
    },
    "stock.accion.registrar": {
      usos: ["FormularioDeReasignarLote.cliente.tsx (botón)"],
      fuente: MAQUETA_DE_STOCK,
    },
    "catalogo.accion.cancelar": {
      usos: ["FormularioDeReasignarLote.cliente.tsx (vuelve a los lotes)"],
      fuente: YA_APROBADO,
    },
    "stock.error.saldo_de_lote_insuficiente": {
      usos: ["respuesta-de-stock.ts (cuando se reasigna más de lo que tiene el lote)"],
      fuente: ESCRITURA_APROBADA,
    },
  },
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDePantalla;
