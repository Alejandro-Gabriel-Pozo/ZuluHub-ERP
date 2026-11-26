import type { DefinicionDeCamino } from "./tipos-de-caminos";

/**
 * Los caminos del módulo producción (ver `caminos.ts`), en su propio archivo para que dos ramas que suman caminos de módulos distintos no toquen las mismas líneas. Un camino no puede estar
 * en dos fragmentos (lo comprueba `test/arquitectura/datos-por-modulo.test.ts`).
 */

const HOJA_DE_MOTIVO = "apps/web/ui/plantillas/produccion/HojaDeMotivo.cliente.tsx";
const FORMULARIO_DE_CIERRE =
  "apps/web/ui/plantillas/produccion/FormularioDeCierreDeOrden.cliente.tsx";
const FORMULARIO_DE_NUEVA_ORDEN =
  "apps/web/ui/plantillas/produccion/FormularioDeNuevaOrden.cliente.tsx";

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
  // Órdenes de producción, abrir una: el producto y la cantidad son lo único que escribe la persona; la clave de idempotencia la fija la página (`bind`) y la sucursal, el depósito (el de venta, origen y destino) y la
  // unidad (la del artículo) las decide el servidor. Sin `campo` de error: todo rechazo sale como el genérico o como el aviso «va a quedar en negativo» (`errores-de-produccion.ts`).
  "abrir-orden-de-produccion": {
    funcion: "Abrir una orden de producción",
    pantallas: [FORMULARIO_DE_NUEVA_ORDEN],
    pasos: [
      {
        id: "que-producir",
        campos: { productoId: "producto-a-producir", cantidad: "cantidad-a-producir" },
      },
    ],
    deriva: [],
    accion: {
      clave: "transformaciones.abrir",
      requiere: ["producto-a-producir", "cantidad-a-producir"],
      admite: [],
    },
    camposDeError: [],
  },
  // Órdenes de producción, cerrar una con lo real: lo obtenido, lo real de cada ingrediente (por posición) y, si el artículo lo pide, el vencimiento son lo único que escribe la persona; la orden y la clave de idempotencia
  // las fija la página (`bind`) y el producto y la unidad de cada consumo los pone el servidor desde la orden. Sin `campo` de error: todo rechazo sale como el genérico, como el aviso «va a quedar en negativo» o con el
  // texto de Lotes del vencimiento (`errores-de-produccion.ts`).
  "cerrar-orden-de-produccion": {
    funcion: "Cerrar una orden de producción con lo real",
    pantallas: [FORMULARIO_DE_CIERRE],
    pasos: [
      {
        id: "lo-real",
        campos: {
          consumos: "consumo-real-de-ingrediente",
          obtenido: "cantidad-obtenida-de-orden",
          vence: "vencimiento-del-lote-de-orden",
        },
      },
    ],
    deriva: [],
    accion: {
      clave: "transformaciones.cerrar",
      requiere: ["consumo-real-de-ingrediente", "cantidad-obtenida-de-orden"],
      admite: ["vencimiento-del-lote-de-orden"],
    },
    camposDeError: [],
  },
} as const satisfies Readonly<Record<string, DefinicionDeCamino>>;
