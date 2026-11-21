import type { DefinicionDeCamino } from "./tipos-de-caminos";

/**
 * Los caminos del módulo producción (ver `caminos.ts`), en su propio archivo para que dos ramas que suman caminos de módulos distintos no toquen las mismas líneas. Un camino no puede estar
 * en dos fragmentos (lo comprueba `test/arquitectura/datos-por-modulo.test.ts`). Abrir y cerrar una orden se suman con sus pantallas (tramos siguientes).
 */

const HOJA_DE_MOTIVO = "apps/web/ui/plantillas/produccion/HojaDeMotivo.cliente.tsx";

export const CAMINOS_DE_PRODUCCION = {
  // Órdenes de producción, cancelar una abierta: el motivo es el único dato; la orden la fija la página (`bind`). Sin `campo` de error: todo rechazo de la orden sale como el genérico
  // (no hay un texto aprobado por regla; `errores-de-produccion.ts`).
  "cancelar-orden-de-produccion": {
    funcion: "Cancelar una orden de producción abierta, con motivo",
    pantallas: [HOJA_DE_MOTIVO],
    pasos: [{ id: "motivo-de-la-orden", campos: { motivo: "motivo-de-orden-de-produccion" } }],
    deriva: [],
    accion: {
      clave: "transformaciones.cancelar",
      requiere: ["motivo-de-orden-de-produccion"],
      admite: [],
    },
    camposDeError: [],
  },
  // Órdenes de producción, anular una cerrada: lo mismo, con la acción `transformaciones.anular`.
  "anular-orden-de-produccion": {
    funcion: "Anular una orden de producción cerrada, con motivo",
    pantallas: [HOJA_DE_MOTIVO],
    pasos: [{ id: "motivo-de-la-orden", campos: { motivo: "motivo-de-orden-de-produccion" } }],
    deriva: [],
    accion: {
      clave: "transformaciones.anular",
      requiere: ["motivo-de-orden-de-produccion"],
      admite: [],
    },
    camposDeError: [],
  },
} as const satisfies Readonly<Record<string, DefinicionDeCamino>>;
