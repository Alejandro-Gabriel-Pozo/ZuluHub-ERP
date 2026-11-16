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
const FORMULARIO_DE_GRUPO =
  "apps/web/ui/plantillas/catalogo/FormularioDeGrupoDeOpciones.cliente.tsx";
const FORMULARIO_DE_COPIA =
  "apps/web/ui/plantillas/catalogo/FormularioDeCopiaDeOpciones.cliente.tsx";
const FORMULARIO_DE_CONSUMO =
  "apps/web/ui/plantillas/catalogo/FormularioDeConsumoDeUnGrupo.cliente.tsx";
const CONSUMO_PROPOSITO = (para: string): Proposito => ({
  para,
  fuente:
    "Pedernal-docs/11-especificaciones/pantallas-de-catalogo-restante-inventario.md §2.4 (`guardarConsumoDeGrupo`, permiso `opciones.editar`), conceptos/escala-con-la-medida-y-consumo-por-opcion.md y la maqueta aprobada el 12/11/2026 (`productos.html`, función `vConsumo`, carpeta de prototipos de Pedernal-docs 10-ux-ui)",
});
const OPCIONES_PROPOSITO = (para: string): Proposito => ({
  para,
  fuente:
    "Pedernal-docs/11-especificaciones/pantallas-de-catalogo-restante-inventario.md §2.2 (`editarOpciones`, permiso `opciones.editar`) y la maqueta aprobada el 12/11/2026 (`productos.html`, solapa «Opciones», carpeta de prototipos de Pedernal-docs 10-ux-ui)",
});
const FICHA_PROPOSITO = (para: string): Proposito => ({
  para,
  fuente:
    "Pedernal-docs/11-especificaciones/fichas-de-modulo/a1-productos-y-precios.md §5 (datos del producto y sus primitivas) y la maqueta aprobada el 12/11/2026 (`productos.html`, solapa «Datos», carpeta de prototipos de Pedernal-docs 10-ux-ui)",
});

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
  "nombre-de-grupo-de-opciones": {
    ficha: "src/primitivas/texto/nombre-de-eleccion.ts",
    propositos: [
      OPCIONES_PROPOSITO(
        "Nombre de un grupo de opciones de un producto («Punto de la carne», «Agregados»): obligatorio, hasta 80 caracteres y único por producto.",
      ),
    ],
    consumidores: [FORMULARIO_DE_GRUPO],
    ponerPor: ["opciones.editar"],
    requiere: REQUIERE_CATALOGO,
  },
  "nombre-de-opcion-de-producto": {
    ficha: "src/primitivas/texto/nombre-de-eleccion.ts",
    propositos: [
      OPCIONES_PROPOSITO(
        "Nombre de una opción dentro de un grupo («Jugoso», «Queso extra»): obligatorio, hasta 80 caracteres y único dentro del grupo.",
      ),
    ],
    consumidores: [FORMULARIO_DE_GRUPO],
    ponerPor: ["opciones.editar"],
    requiere: REQUIERE_CATALOGO,
  },
  "recargo-de-opcion-de-producto": {
    // El recargo se tipea en pesos con dos decimales (`CampoImporte`) y viaja como texto decimal; que sea válido (sin signo, hasta 6 decimales) y que solo lo lleve una opción adicional lo decide `editarOpciones`.
    ficha: "src/primitivas/dinero/precio-de-venta.ts",
    propositos: [
      OPCIONES_PROPOSITO(
        "Recargo de una opción, IVA incluido: lo que suma al precio cuando se elige. Una opción de un grupo incluido no lleva recargo.",
      ),
    ],
    consumidores: [FORMULARIO_DE_GRUPO],
    ponerPor: ["opciones.editar"],
    requiere: REQUIERE_CATALOGO,
  },
  "clase-de-grupo-de-opciones": {
    // La clase (incluida o adicional) es una lista cerrada del módulo de catálogo; se elige al crear el grupo y no se cambia (`editarOpciones` rechaza otra clase).
    ficha: "src/modulos/catalogo/dominio/modelo.ts",
    propositos: [
      OPCIONES_PROPOSITO(
        "Clase de un grupo nuevo: incluida (viene con el producto, sin recargo) o adicional (se suma y puede llevar recargo). Se elige al crear el grupo y no se cambia después.",
      ),
    ],
    consumidores: [FORMULARIO_DE_GRUPO],
    ponerPor: ["opciones.editar"],
    requiere: REQUIERE_CATALOGO,
  },
  "obligatoriedad-de-grupo-de-opciones": {
    ficha: "src/modulos/catalogo/dominio/modelo.ts",
    propositos: [
      OPCIONES_PROPOSITO(
        "Si el grupo de opciones es obligatorio: quien vende tiene que elegir al menos una opción para poder agregar el producto.",
      ),
    ],
    consumidores: [FORMULARIO_DE_GRUPO],
    ponerPor: ["opciones.editar"],
    requiere: REQUIERE_CATALOGO,
  },
  "eleccion-multiple-de-grupo-de-opciones": {
    ficha: "src/modulos/catalogo/dominio/modelo.ts",
    propositos: [
      OPCIONES_PROPOSITO("Si en el grupo de opciones se puede elegir más de una opción a la vez."),
    ],
    consumidores: [FORMULARIO_DE_GRUPO],
    ponerPor: ["opciones.editar"],
    requiere: REQUIERE_CATALOGO,
  },
  "visibilidad-en-la-carta-de-grupo-de-opciones": {
    ficha: "src/modulos/catalogo/dominio/modelo.ts",
    propositos: [
      OPCIONES_PROPOSITO(
        "Si el grupo de opciones se muestra en la carta: un grupo que no figura en la carta solo lo ve quien vende y no puede llevar recargos.",
      ),
    ],
    consumidores: [FORMULARIO_DE_GRUPO],
    ponerPor: ["opciones.editar"],
    requiere: REQUIERE_CATALOGO,
  },
  "precio-de-medida-de-producto": {
    // El importe se tipea en pesos con dos decimales (`CampoImporte`) y viaja como texto decimal; la validez la decide esta primitiva dentro de `cambiarPrecio`.
    ficha: "src/primitivas/dinero/precio-de-venta.ts",
    propositos: [
      {
        para: "Precio de venta de la empresa de una medida de un producto con variante, IVA incluido, en la solapa «Precios»: se cambia agregando una fila al historial de esa medida.",
        fuente:
          "Pedernal-docs/11-especificaciones/pantallas-de-catalogo-restante-inventario.md §2.3 (`cambiarPrecio` con `opcionId`) y la maqueta aprobada el 12/11/2026 (`productos.html`, función `vPrecios`, carpeta de prototipos de Pedernal-docs 10-ux-ui); fila 98 de decisiones-del-dueno-2026-11.md (13/11/2026)",
      },
    ],
    consumidores: ["apps/web/ui/plantillas/catalogo/FormularioDePreciosPorMedida.cliente.tsx"],
    ponerPor: ["productos.cambiar_precio"],
    requiere: REQUIERE_CATALOGO,
  },
  "medida-de-variante-de-producto": {
    // Un sí o un no del negocio del módulo de catálogo: si la variante del producto es la medida (decisión 138: una sola variante, y solo ella puede ser la medida).
    ficha: "src/modulos/catalogo/dominio/modelo.ts",
    propositos: [
      OPCIONES_PROPOSITO(
        "Si la variante del producto es la medida (chica, mediana, grande…): solo la medida lleva un precio propio por cada opción y escala el consumo.",
      ),
    ],
    consumidores: [FORMULARIO_DE_GRUPO],
    ponerPor: ["variantes.editar"],
    requiere: REQUIERE_CATALOGO,
  },
  "insumo-de-consumo-de-opcion": {
    // Una referencia a un producto activo de la empresa que se puede consumir (materia prima, insumo, reventa o elaborado): la fuente de la lista es `productosParaConsumo`.
    ficha: "src/modulos/catalogo/consultas/consultas.ts",
    propositos: [
      CONSUMO_PROPOSITO(
        "Insumo que consume una opción cuando se elige: uno de los productos de la empresa que se consumen (materia prima, insumo, reventa o elaborado), sin repetir dentro de la opción.",
      ),
    ],
    consumidores: [FORMULARIO_DE_CONSUMO],
    ponerPor: ["opciones.editar"],
    requiere: REQUIERE_CATALOGO,
  },
  "cantidad-de-consumo-de-opcion": {
    ficha: "src/primitivas/cantidad/cantidad.ts",
    propositos: [
      CONSUMO_PROPOSITO(
        "Cuánto consume una opción de un insumo, en la unidad base del insumo: mayor que cero y hasta cuatro decimales.",
      ),
    ],
    consumidores: [FORMULARIO_DE_CONSUMO],
    ponerPor: ["opciones.editar"],
    requiere: REQUIERE_CATALOGO,
  },
  "escala-con-la-medida-de-consumo": {
    ficha: "src/modulos/catalogo/dominio/modelo.ts",
    propositos: [
      CONSUMO_PROPOSITO(
        "Si la cantidad que consume una opción se multiplica por el factor de la medida elegida (solo si el producto tiene una variante que es la medida).",
      ),
    ],
    consumidores: [FORMULARIO_DE_CONSUMO],
    ponerPor: ["opciones.editar"],
    requiere: REQUIERE_CATALOGO,
  },
  "producto-de-origen-de-copia-de-opciones": {
    // Una referencia a un producto activo de la empresa con opciones propias (no hay primitiva de texto: la fuente de la lista es `productosParaCopiar`).
    ficha: "src/modulos/catalogo/consultas/consultas.ts",
    propositos: [
      OPCIONES_PROPOSITO(
        "Producto del que se copian las opciones al producto de la pantalla («Copiar de otro producto»): uno activo de la empresa con opciones, distinto del destino.",
      ),
    ],
    consumidores: [FORMULARIO_DE_COPIA],
    ponerPor: ["opciones.editar"],
    requiere: REQUIERE_CATALOGO,
  },
} as const satisfies Readonly<Record<string, DefinicionDeDato>>;
