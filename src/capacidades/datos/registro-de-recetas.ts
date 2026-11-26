import type { DefinicionDeDato, Proposito } from "./tipos-de-datos";

/**
 * Los datos de la pantalla de Recetas (REC-B: nueva receta y editar) del registro de datos (ver `registro.ts`), en su propio archivo para que dos ramas que suman datos de módulos
 * distintos no toquen las mismas líneas. Un dato no puede estar en dos fragmentos (lo comprueba `test/arquitectura/datos-por-modulo.test.ts`). El buscador de la hoja de ingredientes
 * (`texto-de-busqueda-de-ingrediente`) se suma con esa hoja, que no entra en este tramo: los ingredientes se eligen en un selector con la lista completa.
 */

const REQUIERE_STOCK = { modulo: "stock", estadoDeEmpresa: ["ACTIVE"] } as const;
const FORMULARIO_DE_RECETA = "apps/web/ui/plantillas/recetas/FormularioDeReceta.cliente.tsx";
const CONSULTAS_DE_RECETAS = "src/modulos/stock/consultas/recetas-para-pantalla.ts";
const RECETA_PROPOSITO = (para: string): Proposito => ({
  para,
  fuente:
    "Pedernal-docs/11-especificaciones/conceptos/recetas-pantalla.md §4 y §6 (decisión del dueño del 15/11/2026, R1 = B: la pantalla crea la receta, agrega y quita ingredientes, carga rinde y pasos) y la maqueta aprobada `receta.html` del 15/11/2026 (carpeta 10-ux-ui de Pedernal-docs)",
});

export const DATOS_DE_RECETAS = {
  "producto-de-receta": {
    // Una referencia a un producto activo de la empresa que se vende o se elabora y todavía no tiene receta: la fuente de la lista es `listarRecetas` con `conReceta: false`.
    ficha: CONSULTAS_DE_RECETAS,
    propositos: [
      RECETA_PROPOSITO(
        "Producto al que se le carga la primera receta: uno de los productos activos de la empresa, vendible o elaborado, que todavía no tiene receta.",
      ),
    ],
    consumidores: [FORMULARIO_DE_RECETA],
    ponerPor: ["composiciones.editar"],
    requiere: REQUIERE_STOCK,
  },
  "rinde-de-receta": {
    ficha: "src/primitivas/cantidad/cantidad.ts",
    propositos: [
      RECETA_PROPOSITO(
        "Cuántas unidades vendidas rinde la receta: mayor que cero y hasta cuatro decimales (lo de mayor que cero lo exige el dominio).",
      ),
    ],
    consumidores: [FORMULARIO_DE_RECETA],
    ponerPor: ["composiciones.editar"],
    requiere: REQUIERE_STOCK,
  },
  "ingrediente-de-receta": {
    // Una referencia a un ingrediente que se ofrece: un artículo de stock activo que no es insumo, o un elaborado activo (`ingredientesParaReceta`).
    ficha: CONSULTAS_DE_RECETAS,
    propositos: [
      RECETA_PROPOSITO(
        "Ingrediente de la receta: un artículo de stock activo que no es insumo (materia prima o reventa) o un elaborado activo, sin repetir dentro de la receta.",
      ),
    ],
    consumidores: [FORMULARIO_DE_RECETA],
    ponerPor: ["composiciones.editar"],
    requiere: REQUIERE_STOCK,
  },
  "bruto-de-ingrediente-de-receta": {
    ficha: "src/primitivas/cantidad/cantidad.ts",
    propositos: [
      RECETA_PROPOSITO(
        "Cuánto lleva la receta de un ingrediente, en bruto y en la unidad de ese ingrediente: mayor que cero y hasta cuatro decimales (lo de mayor que cero lo exige el dominio).",
      ),
    ],
    consumidores: [FORMULARIO_DE_RECETA],
    ponerPor: ["composiciones.editar"],
    requiere: REQUIERE_STOCK,
  },
  "merma-de-ingrediente-de-receta": {
    ficha: "src/primitivas/cantidad/merma.ts",
    propositos: [
      RECETA_PROPOSITO(
        "Cuánto se pierde de un ingrediente al prepararlo, en puntos de 0 a menos de 100 y hasta cuatro decimales; en blanco es sin merma.",
      ),
    ],
    consumidores: [FORMULARIO_DE_RECETA],
    ponerPor: ["composiciones.editar"],
    requiere: REQUIERE_STOCK,
  },
  "pasos-de-receta": {
    ficha: "src/primitivas/texto/pasos-de-receta.ts",
    propositos: [
      RECETA_PROPOSITO("Los pasos de la ficha de cocina: una línea de texto, opcional."),
    ],
    consumidores: [FORMULARIO_DE_RECETA],
    ponerPor: ["composiciones.editar"],
    requiere: REQUIERE_STOCK,
  },
} as const satisfies Readonly<Record<string, DefinicionDeDato>>;
