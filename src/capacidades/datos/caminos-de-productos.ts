import type { DefinicionDeCamino } from "./tipos-de-caminos";

/**
 * Los caminos del módulo productos (ver `caminos.ts`), en su propio archivo para que dos ramas que suman caminos de módulos distintos no toquen las mismas líneas: solo
 * cambia la ubicación, ningún camino. Un camino no puede estar en dos fragmentos (lo comprueba `test/arquitectura/datos-por-modulo.test.ts`).
 */

const LISTA_DE_PRODUCTOS =
  "apps/web/ui/plantillas/catalogo/FormularioDeFiltrosDeProductos.cliente.tsx";

const BUSCADOR_DE_CANDIDATOS =
  "apps/web/ui/plantillas/catalogo/FormularioDeBuscadorDeCandidatos.cliente.tsx";

const FORMULARIO_DE_FICHA_DE_PRODUCTO =
  "apps/web/ui/plantillas/catalogo/FormularioDeFichaDeProducto.cliente.tsx";

const FORMULARIO_DE_PRECIO_DE_PRODUCTO =
  "apps/web/ui/plantillas/catalogo/FormularioDePrecioDeProducto.cliente.tsx";

const FORMULARIO_DE_ALTA_DE_PRODUCTO =
  "apps/web/ui/plantillas/catalogo/FormularioDeAltaDeProducto.cliente.tsx";

const FORMULARIO_DE_SECCION_DE_CARTA =
  "apps/web/ui/plantillas/catalogo/FormularioDeSeccionDeCarta.cliente.tsx";

export const CAMINOS_DE_PRODUCTOS = {
  // Productos, precio de la empresa (A1, T3): el precio es el único dato; el producto, la clave del cambio y la fila vista los fija la página. El único error con campo es «Escribí
  // un precio válido» (y la frase del precio que otra persona cambió antes, que se muestra en el mismo campo), ambos de la maqueta `productos.html`.
  "cambiar-precio-de-producto": {
    funcion: "Cambiar el precio de la empresa de un producto",
    pantallas: [FORMULARIO_DE_PRECIO_DE_PRODUCTO],
    pasos: [{ id: "precio-del-producto", campos: { precio: "precio-de-venta-de-producto" } }],
    deriva: [],
    accion: {
      clave: "productos.cambiar_precio",
      requiere: ["precio-de-venta-de-producto"],
      admite: [],
    },
    camposDeError: ["precio"],
  },
  // Productos, lista: buscar por nombre y filtrar por clase y por estado. Es una lectura: la acción es la que deja mirar (`productos.ver`) y ningún dato es obligatorio (todo vacío es «todos»).
  // Sin `campo` de error: un filtro que no puede coincidir devuelve la lista vacía, no un error (`entradas-de-productos.ts`).
  "buscar-productos": {
    funcion: "Buscar productos de la empresa por nombre, clase y estado",
    pantallas: [LISTA_DE_PRODUCTOS],
    pasos: [
      {
        id: "filtros-de-la-lista",
        campos: {
          texto: "texto-de-busqueda-de-producto",
          clase: "clase-de-uso-de-producto",
          estado: "estado-de-producto",
        },
      },
    ],
    deriva: [],
    accion: {
      clave: "productos.ver",
      requiere: [],
      admite: ["texto-de-busqueda-de-producto", "clase-de-uso-de-producto", "estado-de-producto"],
    },
    camposDeError: [],
  },
  // Secciones de la carta, «Agregar producto»: buscar entre los productos que se pueden agregar a una sección. Es una lectura (`productos.ver`) y ningún dato es obligatorio (vacío es «todos»). Sin
  // `campo` de error: un texto que no puede coincidir devuelve la lista vacía, no un error (`entradas-de-secciones.ts`).
  "buscar-productos-para-seccion": {
    funcion: "Buscar por nombre los productos que se pueden agregar a una sección de la carta",
    pantallas: [BUSCADOR_DE_CANDIDATOS],
    pasos: [{ id: "buscador-de-candidatos", campos: { texto: "texto-de-busqueda-de-producto" } }],
    deriva: [],
    accion: {
      clave: "productos.ver",
      requiere: [],
      admite: ["texto-de-busqueda-de-producto"],
    },
    camposDeError: [],
  },
  // Productos, ficha de datos: el nombre es el único dato obligatorio para todas las clases; el nombre de cocina, la alícuota (obligatoria si se vende, lo decide el servidor) y la
  // sección son de las clases que se venden. La descripción de la carta no se pide acá (la maqueta no la trae) y se conserva. Los errores con campo son los cuatro que la maqueta
  // `productos.html` redacta para la ficha: nombre repetido o vacío, código repetido, código de barras inválido y alícuota sin elegir.
  "guardar-ficha-de-producto": {
    funcion: "Guardar los datos de un producto de la empresa",
    pantallas: [FORMULARIO_DE_FICHA_DE_PRODUCTO],
    pasos: [
      {
        id: "datos-del-producto",
        campos: {
          nombre: "nombre-de-producto",
          nombreDeCocina: "nombre-de-cocina-de-producto",
          codigo: "codigo-interno-de-producto",
          codigoDeBarras: "codigo-de-barras-de-producto",
          alicuota: "alicuota-de-iva-de-producto",
          seccionDeCartaId: "seccion-de-carta-de-producto",
        },
      },
    ],
    deriva: [],
    accion: {
      clave: "productos.editar",
      requiere: ["nombre-de-producto"],
      admite: [
        "nombre-de-cocina-de-producto",
        "codigo-interno-de-producto",
        "codigo-de-barras-de-producto",
        "alicuota-de-iva-de-producto",
        "seccion-de-carta-de-producto",
      ],
    },
    camposDeError: ["nombre", "codigo", "codigoDeBarras", "alicuota"],
  },
  // Productos, alta: la clase, la unidad y el nombre son obligatorios para todas las clases; el nombre de cocina, la alícuota (obligatoria si se vende, lo decide el servidor) y la sección
  // son de las clases que se venden. La clase y la unidad no se cambian después (dueño, 12/11 y 13/11/2026). Los errores con campo son los que la maqueta `productos.html` redacta: nombre
  // repetido o vacío, código repetido, código de barras inválido y alícuota sin elegir. «Se controla el stock» no se pide: nace sin tildar y el catálogo no lo guarda.
  "crear-producto": {
    funcion: "Crear un producto de la empresa",
    pantallas: [FORMULARIO_DE_ALTA_DE_PRODUCTO],
    pasos: [
      {
        id: "datos-del-producto-nuevo",
        campos: {
          claseDeUso: "clase-de-uso-de-producto",
          nombre: "nombre-de-producto",
          nombreDeCocina: "nombre-de-cocina-de-producto",
          codigo: "codigo-interno-de-producto",
          codigoDeBarras: "codigo-de-barras-de-producto",
          unidadBaseId: "unidad-de-medida-de-producto",
          alicuota: "alicuota-de-iva-de-producto",
          seccionDeCartaId: "seccion-de-carta-de-producto",
        },
      },
    ],
    deriva: [],
    accion: {
      clave: "productos.crear",
      requiere: ["clase-de-uso-de-producto", "nombre-de-producto", "unidad-de-medida-de-producto"],
      admite: [
        "nombre-de-cocina-de-producto",
        "codigo-interno-de-producto",
        "codigo-de-barras-de-producto",
        "alicuota-de-iva-de-producto",
        "seccion-de-carta-de-producto",
      ],
    },
    camposDeError: ["nombre", "codigo", "codigoDeBarras", "alicuota"],
  },
  // Secciones de la carta (A8, parte 1; maqueta aprobada `productos-secciones.html`, 12/11/2026): el nombre es el único dato, para crear y para renombrar. El orden lo calcula el servidor al crear y las
  // flechas no son un campo; la sección y su versión las fija la página. El único error con campo, por ahora, es «Falta el nombre» (el de nombre repetido, «Ya existe una sección con ese nombre», es de la parte 2: hasta entonces sale el genérico).
  "crear-seccion-de-carta": {
    funcion: "Crear una sección de la carta de la empresa",
    pantallas: [FORMULARIO_DE_SECCION_DE_CARTA],
    pasos: [{ id: "nombre-de-la-seccion", campos: { nombre: "nombre-de-seccion-de-carta" } }],
    deriva: [],
    accion: { clave: "productos.editar", requiere: ["nombre-de-seccion-de-carta"], admite: [] },
    camposDeError: ["nombre"],
  },
  "renombrar-seccion-de-carta": {
    funcion: "Renombrar una sección de la carta de la empresa",
    pantallas: [FORMULARIO_DE_SECCION_DE_CARTA],
    pasos: [{ id: "nombre-de-la-seccion", campos: { nombre: "nombre-de-seccion-de-carta" } }],
    deriva: [],
    accion: { clave: "productos.editar", requiere: ["nombre-de-seccion-de-carta"], admite: [] },
    camposDeError: ["nombre"],
  },
} as const satisfies Readonly<Record<string, DefinicionDeCamino>>;
