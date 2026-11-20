import type { DefinicionDeCamino } from "./tipos-de-caminos";

/**
 * Los caminos de la pantalla «Depósitos» de stock (ver `caminos.ts`), en su propio archivo para que las pantallas de stock no toquen las mismas líneas. Solo el alta: editar,
 * desactivar y reactivar existen en el servidor y no tienen pantalla.
 */

const FORMULARIO_DE_DEPOSITO =
  "apps/web/ui/plantillas/stock/depositos/FormularioDeDeposito.cliente.tsx";

export const CAMINOS_DE_STOCK_DEPOSITOS = {
  // La sucursal del depósito nuevo la fija el servidor (la elegida en el dispositivo) y el identificador lo genera la pantalla al abrir el formulario: ninguno es un dato que un paso pida.
  "agregar-deposito": {
    funcion: "Agregar un depósito a la sucursal elegida",
    pantallas: [FORMULARIO_DE_DEPOSITO],
    pasos: [
      {
        id: "datos-del-deposito",
        campos: {
          nombre: "nombre-de-deposito",
          uso: "uso-de-deposito",
          deVenta: "deposito-de-venta",
        },
      },
    ],
    deriva: [],
    accion: {
      clave: "depositos.crear",
      requiere: ["nombre-de-deposito", "uso-de-deposito"],
      admite: ["deposito-de-venta"],
    },
    camposDeError: [],
  },
} as const satisfies Readonly<Record<string, DefinicionDeCamino>>;
