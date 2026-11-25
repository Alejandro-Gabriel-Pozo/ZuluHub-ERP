import type { DefinicionDeCamino } from "./tipos-de-caminos";

/**
 * Los caminos de la solapa «Cómo se compra» de un producto (T0; ver `caminos.ts`), en su propio archivo para que `caminos-de-productos.ts` no pase el tope de líneas por archivo: solo cambia la
 * ubicación. Un camino no puede estar en dos fragmentos (lo comprueba `test/arquitectura/datos-por-modulo.test.ts`).
 */

const FORMULARIO_DE_PRESENTACION =
  "apps/web/ui/plantillas/catalogo/FormularioDePresentacion.cliente.tsx";

export const CAMINOS_DE_PRESENTACIONES = {
  // Agregar una presentación de compra. El producto lo fija la página; la repetición (el mismo nombre con la misma cantidad) devuelve la ya creada. El único error con campo es «La cantidad tiene que
  // ser mayor que cero»; todo otro rechazo (nombre repetido, versión vieja) es el genérico.
  "agregar-presentacion-de-producto": {
    funcion: "Agregar una presentación de compra a un producto",
    pantallas: [FORMULARIO_DE_PRESENTACION],
    pasos: [
      {
        id: "datos-de-la-presentacion",
        campos: {
          nombre: "nombre-de-presentacion",
          cantidad: "cantidad-de-presentacion",
          pesoVariable: "presentacion-de-peso-variable",
        },
      },
    ],
    deriva: [],
    accion: {
      clave: "productos.editar",
      requiere: ["nombre-de-presentacion", "cantidad-de-presentacion"],
      admite: ["presentacion-de-peso-variable"],
    },
    camposDeError: ["cantidad"],
  },
  // Cambiar el nombre de una presentación. La cantidad se ve y no cambia; la presentación y su versión las fija la página. «Desactivar» y «Reactivar» son botones sin campos.
  "renombrar-presentacion-de-producto": {
    funcion: "Cambiar el nombre de una presentación de compra",
    pantallas: [FORMULARIO_DE_PRESENTACION],
    pasos: [{ id: "nombre-de-la-presentacion", campos: { nombre: "nombre-de-presentacion" } }],
    deriva: [],
    accion: {
      clave: "productos.editar",
      requiere: ["nombre-de-presentacion"],
      admite: [],
    },
    camposDeError: [],
  },
} as const satisfies Readonly<Record<string, DefinicionDeCamino>>;
