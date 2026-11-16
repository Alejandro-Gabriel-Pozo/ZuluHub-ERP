import type { DefinicionDeDato, Proposito } from "./tipos-de-datos";

/**
 * Los datos del catálogo de productos del registro de datos (ver `registro.ts`), en su propio archivo para que el registro no pase el tope de líneas por archivo: solo cambia
 * la ubicación, ningún dato ni consumidor. `registro.ts` los junta con el resto.
 */

const LISTA_DE_PRODUCTOS =
  "apps/web/ui/plantillas/catalogo/FormularioDeFiltrosDeProductos.cliente.tsx";
const REQUIERE_CATALOGO = { modulo: "catalogo", estadoDeEmpresa: ["ACTIVE"] } as const;
const FUENTE_DE_LA_LISTA_DE_PRODUCTOS =
  "Pedernal-docs/11-especificaciones/fichas-de-modulo/a1-productos-y-precios.md §3 (consultas: `listarProductos` filtra por texto, clase, «falta completar» y activo) y la maqueta aprobada el 12/11/2026 (`productos.html`, carpeta de prototipos de Pedernal-docs 10-ux-ui)";

const FICHA_DE_PRODUCTO = "apps/web/ui/plantillas/catalogo/FormularioDeFichaDeProducto.cliente.tsx";
const ALTA_DE_PRODUCTO = "apps/web/ui/plantillas/catalogo/FormularioDeAltaDeProducto.cliente.tsx";
const ALTA_PROPOSITO = (para: string): Proposito => ({
  para,
  fuente:
    "Pedernal-docs/11-especificaciones/fichas-de-modulo/a1-productos-y-precios.md §3 (`crearProducto`, permiso `productos.crear`), la maqueta aprobada el 12/11/2026 (`productos.html`, «Nuevo producto», carpeta de prototipos de Pedernal-docs 10-ux-ui) y 11-especificaciones/decisiones-del-dueno-2026-11.md (fila del 13/11/2026: «Se controla el stock» nace sin tildar y la clase no se cambia)",
});
const FICHA_PROPOSITO = (para: string): Proposito => ({
  para,
  fuente:
    "Pedernal-docs/11-especificaciones/fichas-de-modulo/a1-productos-y-precios.md §5 (datos del producto y sus primitivas) y la maqueta aprobada el 12/11/2026 (`productos.html`, solapa «Datos», carpeta de prototipos de Pedernal-docs 10-ux-ui)",
});

const HOJAS_DE_CLASIFICACION = "apps/web/ui/plantillas/catalogo/HojasDeClasificacion.cliente.tsx";
const CLASIFICACION_DEL_PRODUCTO =
  "apps/web/ui/plantillas/catalogo/ClasificacionDelProducto.cliente.tsx";
const CLASIFICACION_PROPOSITO = (para: string): Proposito => ({
  para,
  fuente:
    "Pedernal-docs/11-especificaciones/pantallas-de-catalogo-restante-inventario.md §2.5 (Clasificación), la maqueta aprobada el 12/11/2026 (`clasificacion.html`, carpeta de prototipos de Pedernal-docs 10-ux-ui) y 11-especificaciones/decisiones-del-dueno-2026-11.md (filas del 12/11 y 13/11/2026: árbol departamento → categoría de hasta 4 niveles; el cambio de un producto rige solo desde ahora)",
});
const FORMULARIO_DE_SECCION_DE_CARTA =
  "apps/web/ui/plantillas/catalogo/FormularioDeSeccionDeCarta.cliente.tsx";

export const DATOS_DE_PRODUCTOS = {
  "texto-de-busqueda-de-producto": {
    ficha: "src/primitivas/texto/termino-de-busqueda-de-producto.ts",
    propositos: [
      {
        para: "Texto con el que se busca un producto por su nombre en la lista de productos (el buscador vacío muestra todo).",
        fuente: FUENTE_DE_LA_LISTA_DE_PRODUCTOS,
      },
    ],
    consumidores: [LISTA_DE_PRODUCTOS],
    ponerPor: ["productos.ver"],
    requiere: REQUIERE_CATALOGO,
  },
  "clase-de-uso-de-producto": {
    // La clase de uso es una lista cerrada del módulo de catálogo, no una primitiva de `src/primitivas/` (ficha de concepto `clase-de-uso.md`): la ficha es su dominio.
    ficha: "src/modulos/catalogo/dominio/clases.ts",
    propositos: [
      {
        para: "Filtro «¿Qué es?» de la lista de productos: una de las cinco clases de uso (materia prima, insumo, reventa, elaborado o producto vendible) o todas.",
        fuente: FUENTE_DE_LA_LISTA_DE_PRODUCTOS,
      },
      ALTA_PROPOSITO(
        "Clase de uso de un producto nuevo en el alta («¿Qué es?»): una de las cinco; se elige al crear y no se cambia después (una clase equivocada se corrige creando el producto correcto y desactivando el otro).",
      ),
    ],
    consumidores: [LISTA_DE_PRODUCTOS, ALTA_DE_PRODUCTO],
    ponerPor: ["productos.ver", "productos.crear"],
    requiere: REQUIERE_CATALOGO,
  },
  "estado-de-producto": {
    // Sin primitiva: el estado (activo, falta completar, desactivado) se deduce de dos marcas del producto y su tipo vive en la consulta del catálogo. Pregunta pendiente al dueño:
    // la maqueta `productos.html` no trae un filtro por estado; lo pidió el encargo de T1.
    ficha: "src/modulos/catalogo/consultas/consultas.ts",
    propositos: [
      {
        para: "Filtro por estado de la lista de productos: activo, falta completar o desactivado, o todos.",
        fuente: FUENTE_DE_LA_LISTA_DE_PRODUCTOS,
      },
    ],
    consumidores: [LISTA_DE_PRODUCTOS],
    ponerPor: ["productos.ver"],
    requiere: REQUIERE_CATALOGO,
  },
  "nombre-de-producto": {
    ficha: "src/primitivas/texto/nombre-de-producto.ts",
    propositos: [
      FICHA_PROPOSITO(
        "Nombre de un producto en su ficha de datos (obligatorio, único por empresa).",
      ),
      ALTA_PROPOSITO("Nombre de un producto nuevo en el alta (obligatorio, único por empresa)."),
    ],
    consumidores: [FICHA_DE_PRODUCTO, ALTA_DE_PRODUCTO],
    ponerPor: ["productos.editar", "productos.crear"],
    requiere: REQUIERE_CATALOGO,
  },
  "nombre-de-cocina-de-producto": {
    ficha: "src/primitivas/texto/nombre-de-cocina.ts",
    propositos: [
      FICHA_PROPOSITO(
        "Nombre con el que la cocina ve un producto que se vende (reventa o producto vendible), en su ficha de datos; vacío: la cocina ve el nombre.",
      ),
      ALTA_PROPOSITO(
        "Nombre con el que la cocina ve un producto nuevo que se vende (reventa o producto vendible), en el alta; vacío: la cocina ve el nombre.",
      ),
    ],
    consumidores: [FICHA_DE_PRODUCTO, ALTA_DE_PRODUCTO],
    ponerPor: ["productos.editar", "productos.crear"],
    requiere: REQUIERE_CATALOGO,
  },
  "codigo-interno-de-producto": {
    ficha: "src/primitivas/texto/codigo-de-producto.ts",
    propositos: [
      FICHA_PROPOSITO(
        "Código interno, opcional y único por empresa, de un producto en su ficha de datos.",
      ),
      ALTA_PROPOSITO(
        "Código interno, opcional y único por empresa, de un producto nuevo en el alta.",
      ),
    ],
    consumidores: [FICHA_DE_PRODUCTO, ALTA_DE_PRODUCTO],
    ponerPor: ["productos.editar", "productos.crear"],
    requiere: REQUIERE_CATALOGO,
  },
  "codigo-de-barras-de-producto": {
    ficha: "src/primitivas/texto/codigo-de-producto.ts",
    propositos: [
      FICHA_PROPOSITO(
        "Código de barras (de 8 a 14 dígitos), opcional, de un producto en su ficha de datos.",
      ),
      ALTA_PROPOSITO(
        "Código de barras (de 8 a 14 dígitos), opcional, de un producto nuevo en el alta.",
      ),
    ],
    consumidores: [FICHA_DE_PRODUCTO, ALTA_DE_PRODUCTO],
    ponerPor: ["productos.editar", "productos.crear"],
    requiere: REQUIERE_CATALOGO,
  },
  "alicuota-de-iva-de-producto": {
    // La lista que se ofrece (las seis de ARCA, sin «Exento» ni «No gravado») vive una vez, en `ALICUOTAS_DEL_PRODUCTO` del módulo fiscal.
    ficha: "src/modulos/fiscal/dominio/alicuota.ts",
    propositos: [
      FICHA_PROPOSITO(
        "Alícuota de IVA de un producto que se vende, en su ficha de datos: una de las seis que ofrece el producto; es una decisión fiscal y no tiene valor por defecto.",
      ),
      ALTA_PROPOSITO(
        "Alícuota de IVA de un producto nuevo que se vende, en el alta: una de las seis que ofrece el producto; es una decisión fiscal y no tiene valor por defecto.",
      ),
    ],
    consumidores: [FICHA_DE_PRODUCTO, ALTA_DE_PRODUCTO],
    ponerPor: ["productos.editar", "productos.crear"],
    requiere: REQUIERE_CATALOGO,
  },
  "seccion-de-carta-de-producto": {
    // Una referencia a una sección activa de la carta de la empresa (no hay primitiva de texto: la fuente de las opciones es la consulta de secciones del catálogo).
    ficha: "src/modulos/catalogo/casos-de-uso/secciones.ts",
    propositos: [
      FICHA_PROPOSITO(
        "Sección de la carta a la que pertenece un producto que se vende, en su ficha de datos: una de las secciones activas de la empresa, o ninguna.",
      ),
      ALTA_PROPOSITO(
        "Sección de la carta de un producto nuevo que se vende, en el alta: una de las secciones activas de la empresa, o ninguna.",
      ),
    ],
    consumidores: [FICHA_DE_PRODUCTO, ALTA_DE_PRODUCTO],
    ponerPor: ["productos.editar", "productos.crear"],
    requiere: REQUIERE_CATALOGO,
  },
  "nombre-de-seccion-de-carta": {
    // La primitiva ya existe y es la que valida el servidor (`secciones.ts`): largo y conjunto permitido viven ahí, una sola vez; la pantalla no escribe ningún número.
    ficha: "src/primitivas/texto/nombre-de-eleccion.ts",
    propositos: [
      {
        para: "Nombre de una sección de la carta, al crearla y al renombrarla: de 1 a 80 caracteres, único por empresa sin distinguir mayúsculas (`claveDeNombre`: NFC y minúsculas; los acentos distinguen).",
        fuente:
          "la maqueta aprobada el 12/11/2026 (`productos-secciones.html` líneas 303, 486 y 488, carpeta de prototipos de Pedernal-docs 10-ux-ui), Pedernal-docs/11-especificaciones/e2-catalogo-minimo-especificacion.md §3.5 y 11-especificaciones/decisiones-del-dueno-2026-11.md línea 90 (quién: gerente y administrador, el mismo permiso que las secciones)",
      },
    ],
    consumidores: [FORMULARIO_DE_SECCION_DE_CARTA],
    ponerPor: ["productos.editar"],
    requiere: REQUIERE_CATALOGO,
  },
  "unidad-de-medida-de-producto": {
    // La lista cerrada de las 14 unidades vive una vez, en `UNIDADES` (copia de la tabla `unidad_de_medida`). Al crear, la unidad de venta es la base y el paso es 1 (decisión 162: el piloto no vende por fracciones ni por peso).
    ficha: "src/primitivas/unidades/unidades.ts",
    propositos: [
      ALTA_PROPOSITO(
        "Unidad base de un producto nuevo en el alta: una de las 14 unidades de medida; se elige al crear y no se cambia después.",
      ),
    ],
    consumidores: [ALTA_DE_PRODUCTO],
    ponerPor: ["productos.crear"],
    requiere: REQUIERE_CATALOGO,
  },
  "precio-de-venta-de-producto": {
    // El importe se tipea en pesos con dos decimales (`CampoImporte`) y viaja como texto decimal; la validez (sin signo, hasta 6 decimales, en rango) la decide esta primitiva dentro de `cambiarPrecio`.
    ficha: "src/primitivas/dinero/precio-de-venta.ts",
    propositos: [
      {
        para: "Precio de venta de la empresa de un producto, IVA incluido, en la solapa «Precios» de su ficha: se cambia agregando una fila al historial.",
        fuente:
          "Pedernal-docs/11-especificaciones/fichas-de-modulo/a1-productos-y-precios.md §2 (`cambiarPrecio`) y §5 (dinero en texto decimal, ADR-006) y la maqueta aprobada el 12/11/2026 (`productos.html`, solapa «Precios», carpeta de prototipos de Pedernal-docs 10-ux-ui)",
      },
    ],
    consumidores: ["apps/web/ui/plantillas/catalogo/FormularioDePrecioDeProducto.cliente.tsx"],
    ponerPor: ["productos.cambiar_precio"],
    requiere: REQUIERE_CATALOGO,
  },
  "nombre-de-nodo-de-clasificacion": {
    // Es el mismo texto que el nombre de una sección de la carta (1 a 80): una sola regla, la de `nombre-de-eleccion.ts`, reexportada por esta primitiva.
    ficha: "src/primitivas/clasificacion/nombre-de-nodo.ts",
    propositos: [
      CLASIFICACION_PROPOSITO(
        "Nombre de un departamento o de una categoría de la clasificación comercial, al crearlo y al renombrarlo (único entre hermanos; no hereda la alícuota).",
      ),
    ],
    consumidores: [HOJAS_DE_CLASIFICACION],
    ponerPor: ["productos.editar"],
    requiere: REQUIERE_CATALOGO,
  },
  "padre-de-nodo-de-clasificacion": {
    // Una referencia a un nodo activo de la empresa que no sea el propio nodo ni uno de sus descendientes y que no pase el tope de niveles: las reglas viven una vez, en `arbol.ts`.
    ficha: "src/primitivas/clasificacion/arbol.ts",
    propositos: [
      CLASIFICACION_PROPOSITO(
        "Nuevo padre de una categoría que se mueve en el árbol de la clasificación comercial: un nodo activo que no sea ella ni lo que tiene adentro y que no pase el tope de niveles; un departamento no se mueve.",
      ),
    ],
    consumidores: [HOJAS_DE_CLASIFICACION],
    ponerPor: ["productos.editar"],
    requiere: REQUIERE_CATALOGO,
  },
  "nodo-de-clasificacion-de-producto": {
    // Una referencia a un nodo activo de la clasificación de la empresa (un selector por nivel, encadenados); vacío es «Sin elegir». Rige desde ahora: no hay fecha (dueño, 13/11/2026).
    ficha: "src/modulos/catalogo/casos-de-uso/clasificar-producto.ts",
    propositos: [
      CLASIFICACION_PROPOSITO(
        "Departamento o categoría de un producto en su ficha, en la hoja «Cambiar»: un selector por nivel, encadenados; elegir «Sin elegir» lo deja sin clasificar. El cambio rige desde ahora y el vínculo anterior queda en el historial.",
      ),
    ],
    consumidores: [CLASIFICACION_DEL_PRODUCTO],
    ponerPor: ["productos.editar"],
    requiere: REQUIERE_CATALOGO,
  },
} as const satisfies Readonly<Record<string, DefinicionDeDato>>;
