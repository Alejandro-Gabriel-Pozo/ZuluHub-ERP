import type { DefinicionDeCamino } from "./tipos-de-caminos";

/** Los caminos de los formularios de movimientos de stock (ver `caminos.ts`). La clave de idempotencia y la sucursal no son datos que un paso pida: las pone la página y el servidor. El producto y la unidad salen del artículo, en el servidor. */

const FORMULARIO = "apps/web/ui/plantillas/stock/movimientos/FormularioDeMovimiento.cliente.tsx";
export const CAMINOS_DE_STOCK_MOVIMIENTOS = {
  "registrar-entrada": {
    funcion: "Registrar una entrada de stock a mano",
    pantallas: [FORMULARIO],
    pasos: [
      {
        id: "datos-de-la-entrada",
        campos: {
          depositoId: "deposito-de-stock",
          articuloId: "articulo-de-stock",
          cantidad: "cantidad-de-movimiento-de-stock",
          motivo: "motivo-de-movimiento-de-stock",
          costoUnitario: "costo-por-unidad-de-entrada",
          detalle: "detalle-de-movimiento-de-stock",
        },
      },
    ],
    deriva: [],
    accion: {
      clave: "stock.registrar_entrada",
      requiere: [
        "deposito-de-stock",
        "articulo-de-stock",
        "cantidad-de-movimiento-de-stock",
        "motivo-de-movimiento-de-stock",
      ],
      admite: ["costo-por-unidad-de-entrada", "detalle-de-movimiento-de-stock"],
    },
    camposDeError: [],
  },
  "registrar-salida": {
    funcion: "Registrar una salida de stock a mano",
    pantallas: [FORMULARIO],
    pasos: [
      {
        id: "datos-de-la-salida",
        campos: {
          depositoId: "deposito-de-stock",
          articuloId: "articulo-de-stock",
          cantidad: "cantidad-de-movimiento-de-stock",
          motivo: "motivo-de-movimiento-de-stock",
          detalle: "detalle-de-movimiento-de-stock",
        },
      },
    ],
    deriva: [],
    accion: {
      clave: "stock.registrar_salida",
      requiere: [
        "deposito-de-stock",
        "articulo-de-stock",
        "cantidad-de-movimiento-de-stock",
        "motivo-de-movimiento-de-stock",
      ],
      admite: ["detalle-de-movimiento-de-stock"],
    },
    camposDeError: [],
  },
  "transferir-stock": {
    funcion: "Transferir existencia de un depósito a otro de la sucursal",
    pantallas: [FORMULARIO],
    pasos: [
      {
        id: "datos-de-la-transferencia",
        campos: {
          origenId: "deposito-de-stock",
          destinoId: "deposito-de-stock",
          articuloId: "articulo-de-stock",
          cantidad: "cantidad-de-movimiento-de-stock",
        },
      },
    ],
    deriva: [],
    accion: {
      clave: "stock.transferir",
      requiere: ["deposito-de-stock", "articulo-de-stock", "cantidad-de-movimiento-de-stock"],
      admite: [],
    },
    camposDeError: [],
  },
  "ajustar-stock": {
    funcion: "Corregir la existencia de un artículo (sobra o falta)",
    pantallas: [FORMULARIO],
    pasos: [
      {
        id: "datos-del-ajuste",
        campos: {
          depositoId: "deposito-de-stock",
          articuloId: "articulo-de-stock",
          sentido: "sentido-de-ajuste",
          cantidad: "cantidad-de-movimiento-de-stock",
          detalle: "detalle-de-movimiento-de-stock",
        },
      },
    ],
    deriva: [],
    accion: {
      clave: "stock.ajustar",
      requiere: [
        "deposito-de-stock",
        "articulo-de-stock",
        "sentido-de-ajuste",
        "cantidad-de-movimiento-de-stock",
        "detalle-de-movimiento-de-stock",
      ],
      admite: [],
    },
    camposDeError: [],
  },
  "anular-movimiento": {
    funcion: "Anular un movimiento de stock con su detalle",
    pantallas: [FORMULARIO],
    pasos: [
      { id: "detalle-de-la-anulacion", campos: { detalle: "detalle-de-movimiento-de-stock" } },
    ],
    deriva: [],
    accion: {
      clave: "stock.anular",
      requiere: ["detalle-de-movimiento-de-stock"],
      admite: [],
    },
    camposDeError: [],
  },
} as const satisfies Readonly<Record<string, DefinicionDeCamino>>;
