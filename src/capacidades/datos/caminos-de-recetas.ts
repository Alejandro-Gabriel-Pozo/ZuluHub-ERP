import type { DefinicionDeCamino } from "./tipos-de-caminos";

/**
 * Los caminos del módulo de recetas (ver `caminos.ts`), en su propio archivo para que dos ramas que suman caminos de módulos distintos no toquen las mismas líneas. Un camino no puede estar
 * en dos fragmentos (lo comprueba `test/arquitectura/datos-por-modulo.test.ts`).
 */

export const CAMINOS_DE_RECETAS = {
  // Recetas, crear o editar: el producto (solo al crear), el rinde, los pasos y las líneas (`receta_<línea>_ingrediente|bruto|merma`, campos repetidos: acá `ingrediente`, `bruto` y `merma`).
  // La versión que se vio y la unidad de cada ingrediente las fija la página (`bind`). Sin `campo` de error: todo rechazo de la receta sale como el genérico (`errores-de-recetas.ts`).
  "guardar-receta": {
    funcion: "Crear la receta de un producto o guardar una versión nueva de la que tiene",
    pantallas: ["apps/web/ui/plantillas/recetas/FormularioDeReceta.cliente.tsx"],
    pasos: [
      {
        id: "datos-de-la-receta",
        campos: {
          producto: "producto-de-receta",
          rinde: "rinde-de-receta",
          pasos: "pasos-de-receta",
        },
      },
      {
        id: "ingredientes-de-la-receta",
        campos: {
          ingrediente: "ingrediente-de-receta",
          bruto: "bruto-de-ingrediente-de-receta",
          merma: "merma-de-ingrediente-de-receta",
        },
      },
    ],
    deriva: [],
    accion: {
      clave: "composiciones.editar",
      requiere: [
        "producto-de-receta",
        "rinde-de-receta",
        "ingrediente-de-receta",
        "bruto-de-ingrediente-de-receta",
      ],
      admite: ["merma-de-ingrediente-de-receta", "pasos-de-receta"],
    },
    camposDeError: [],
  },
} as const satisfies Readonly<Record<string, DefinicionDeCamino>>;
