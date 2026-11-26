import type { DefinicionDeCamino } from "./tipos-de-caminos";

/** Los caminos de escritura de «Lotes» (ver `caminos.ts`). El lote, su versión, el artículo, el lote de origen y la clave de la reasignación no son datos que un paso pida: los pone la página y el servidor. */

const CORREGIR = "apps/web/ui/plantillas/stock/lotes/FormularioDeCorregirLote.cliente.tsx";
const REASIGNAR = "apps/web/ui/plantillas/stock/lotes/FormularioDeReasignarLote.cliente.tsx";

export const CAMINOS_DE_STOCK_LOTES = {
  "corregir-lote": {
    funcion: "Corregir la fecha de vencimiento de un lote",
    pantallas: [CORREGIR],
    pasos: [
      {
        id: "la-correccion",
        campos: {
          vence: "vencimiento-de-lote",
          detalle: "detalle-de-movimiento-de-stock",
        },
      },
    ],
    deriva: [],
    accion: {
      clave: "lotes.corregir",
      requiere: ["vencimiento-de-lote", "detalle-de-movimiento-de-stock"],
      admite: [],
    },
    camposDeError: [],
  },
  "reasignar-lote": {
    funcion: "Reasignar existencia de un lote a otro del mismo artículo y depósito",
    pantallas: [REASIGNAR],
    pasos: [
      {
        id: "la-reasignacion",
        campos: {
          depositoId: "deposito-de-stock",
          loteDestinoId: "lote-de-destino-de-reasignacion",
          cantidad: "cantidad-de-movimiento-de-stock",
          detalle: "detalle-de-movimiento-de-stock",
        },
      },
    ],
    deriva: [],
    accion: {
      clave: "lotes.reasignar",
      requiere: [
        "deposito-de-stock",
        "lote-de-destino-de-reasignacion",
        "cantidad-de-movimiento-de-stock",
        "detalle-de-movimiento-de-stock",
      ],
      admite: [],
    },
    camposDeError: [],
  },
} as const satisfies Readonly<Record<string, DefinicionDeCamino>>;
