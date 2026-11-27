import type { DefinicionDeCamino } from "./tipos-de-caminos";

/** Los caminos del conteo físico de stock (ver `caminos.ts`). El conteo, el artículo y la clave de cada registro no son datos que un paso pida: los pone la página y el servidor. */

const CARGA = "apps/web/ui/plantillas/stock/conteo/CargaDeConteo.cliente.tsx";
const APLICAR = "apps/web/ui/plantillas/stock/conteo/FormularioDeAplicarConteo.cliente.tsx";
const CANCELAR = "apps/web/ui/plantillas/stock/conteo/FormularioDeCancelarConteo.cliente.tsx";

export const CAMINOS_DE_STOCK_CONTEO = {
  "registrar-lo-contado": {
    funcion: "Guardar lo contado de un artículo del conteo abierto",
    pantallas: [CARGA],
    pasos: [
      {
        id: "lo-contado",
        campos: { cantidad: "cantidad-contada", hora: "hora-del-conteo" },
      },
    ],
    deriva: [],
    accion: {
      clave: "conteos.registrar",
      requiere: ["cantidad-contada"],
      admite: ["hora-del-conteo"],
    },
    camposDeError: [],
  },
  "aplicar-conteo": {
    funcion: "Aplicar el conteo con el motivo de cada diferencia",
    pantallas: [APLICAR],
    pasos: [
      {
        id: "motivo-de-la-diferencia",
        campos: {
          motivo: "motivo-de-diferencia-de-conteo",
          detalle: "detalle-de-movimiento-de-stock",
        },
      },
    ],
    deriva: [],
    accion: {
      clave: "conteos.aplicar",
      requiere: ["motivo-de-diferencia-de-conteo"],
      admite: ["detalle-de-movimiento-de-stock"],
    },
    camposDeError: [],
  },
  "cancelar-conteo": {
    funcion: "Cancelar un conteo abierto con su motivo",
    pantallas: [CANCELAR],
    pasos: [
      { id: "motivo-de-la-cancelacion", campos: { motivo: "detalle-de-movimiento-de-stock" } },
    ],
    deriva: [],
    accion: {
      clave: "conteos.cancelar",
      requiere: ["detalle-de-movimiento-de-stock"],
      admite: [],
    },
    camposDeError: [],
  },
} as const satisfies Readonly<Record<string, DefinicionDeCamino>>;
