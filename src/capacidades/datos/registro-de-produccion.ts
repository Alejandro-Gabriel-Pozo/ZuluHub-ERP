import type { DefinicionDeDato } from "./tipos-de-datos";

/**
 * Los datos del módulo producción (órdenes de producción) del registro de datos (ver `registro.ts`), en su propio archivo para que dos ramas que suman datos de módulos distintos no toquen
 * las mismas líneas. Un dato no puede estar en dos fragmentos (lo comprueba `test/arquitectura/datos-por-modulo.test.ts`). Los demás datos de las pantallas de producción (cantidad obtenida, consumo real, vencimiento del lote) se suman con sus pantallas (tramos siguientes).
 */

const REQUIERE_PRODUCCION = { modulo: "produccion", estadoDeEmpresa: ["ACTIVE"] } as const;
const HOJA_DE_MOTIVO = "apps/web/ui/plantillas/produccion/HojaDeMotivo.cliente.tsx";
const FORMULARIO_DE_NUEVA_ORDEN =
  "apps/web/ui/plantillas/produccion/FormularioDeNuevaOrden.cliente.tsx";
const FUENTE_DE_NUEVA_ORDEN =
  "Pedernal-docs/11-especificaciones/pantallas-de-produccion-inventario.md §3 (Pantalla 2: Nueva orden) y §9 (datos a registrar: «Producto» de la orden y «Cantidad a producir»); maqueta `produccion.html` (pantalla «Nueva orden», 09/11/2026)";

export const DATOS_DE_PRODUCCION = {
  "motivo-de-orden-de-produccion": {
    ficha: "src/primitivas/texto/motivo-de-orden-de-produccion.ts",
    propositos: [
      {
        para: "Motivo, obligatorio, de cancelar una orden abierta o de anular una cerrada (hoja de motivo de la ficha de la orden de producción).",
        fuente:
          "Pedernal-docs/11-especificaciones/pantallas-de-produccion-inventario.md §4 F4 y §9 (el servidor y la base exigen el motivo al cancelar y al anular) y la fila del 15/11/2026 de decisiones-del-dueno-2026-11.md («Resueltas por el orquestador… Producción», Q1: al cancelar se pide el motivo con la misma hoja de «Anular»); maqueta `produccion.html` (hoja «Anular la orden», 09/11/2026)",
      },
    ],
    consumidores: [HOJA_DE_MOTIVO],
    ponerPor: ["transformaciones.cancelar", "transformaciones.anular"],
    requiere: REQUIERE_PRODUCCION,
  },
  "producto-a-producir": {
    // Una referencia a un producto de la empresa con receta vigente y artículo propio activo: la fuente de la lista es la intersección de `listarRecetas` (con receta) y `articulosControlados` (`nueva-orden-web.ts`).
    ficha: "src/modulos/stock/consultas/recetas-para-pantalla.ts",
    propositos: [
      {
        para: "Producto que se va a producir en la orden: uno de los que tienen receta vigente y artículo propio activo; su unidad es la del artículo y no se elige.",
        fuente: FUENTE_DE_NUEVA_ORDEN,
      },
    ],
    consumidores: [FORMULARIO_DE_NUEVA_ORDEN],
    ponerPor: ["transformaciones.abrir"],
    requiere: REQUIERE_PRODUCCION,
  },
  "cantidad-a-producir": {
    ficha: "src/primitivas/cantidad/cantidad.ts",
    propositos: [
      {
        para: "Cuánto se va a producir: mayor que cero y hasta cuatro decimales, en la unidad del producto (lo de mayor que cero lo exige el caso de uso al abrir la orden).",
        fuente: FUENTE_DE_NUEVA_ORDEN,
      },
    ],
    consumidores: [FORMULARIO_DE_NUEVA_ORDEN],
    ponerPor: ["transformaciones.abrir"],
    requiere: REQUIERE_PRODUCCION,
  },
} as const satisfies Readonly<Record<string, DefinicionDeDato>>;
