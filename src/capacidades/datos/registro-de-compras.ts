import type { DefinicionDeDato, Proposito } from "./tipos-de-datos";

/**
 * Los datos de la lista de compras del registro de datos (ver `registro.ts`), en su propio archivo (una línea en el registro por módulo, sin pisar a los demás): los tres campos del filtro de la
 * pantalla «Compras» (Compras PR 3). Son filtros de lectura: los pone quien puede ver las compras (`recepciones.ver`, los tres roles). La lista cerrada del estado y la validez de una fecha viven UNA vez
 * (`src/composicion/entradas-de-compras.ts` y `src/primitivas/tiempo/fecha-civil.ts`); la pantalla no copia ninguna regla: lo que no es permitido vuelve al valor por defecto en el servidor.
 */

const FORMULARIO_DE_FILTROS =
  "apps/web/ui/plantillas/compras/lista/FormularioDeFiltrosDeCompras.cliente.tsx";
const REQUIERE_COMPRAS = { modulo: "compras", estadoDeEmpresa: ["ACTIVE"] } as const;
const VER_COMPRAS = ["recepciones.ver"] as const;

const DEL_FILTRO = (para: string): Proposito => ({
  para,
  fuente:
    "Pedernal-docs/11-especificaciones/briefs/compras/PR-3-lista-y-ficha-de-compra.md §4.1 punto 5 y §4.3 (chips «Todas» y «Sin facturar» y «Aplicar filtros» como el listado de facturación y el directorio, DDD:294); quién: los tres roles (recepciones.ver, DDD:247)",
});

const PRUEBA_DEL_BUSCADOR = "apps/web/ui/componentes/BuscadorEnLista.test.tsx";
const REGISTRAR_COMPRA = ["recepciones.registrar"] as const;

const FORMULARIO_DEL_NIVEL =
  "apps/web/ui/plantillas/compras/nivel/FormularioDeNivelDeCompras.cliente.tsx";

const FORMULARIO_DE_CORREGIR =
  "apps/web/ui/plantillas/compras/correccion/FormularioDeCorregirLinea.cliente.tsx";
const HOJA_DE_ANULAR = "apps/web/ui/plantillas/compras/correccion/HojaDeAnularCompra.cliente.tsx";
const CORREGIR_COMPRA = ["compras.corregir"] as const;
const ANULAR_COMPRA = ["recepciones.anular"] as const;
const DE_CORREGIR_Y_ANULAR = (para: string): Proposito => ({
  para,
  fuente:
    "Pedernal-docs, brief `PR-10-corregir-y-anular-pantalla.md` de Compras (rama de planificación de la Ola 1) y maqueta `compra-corregir-anular.html` (`vForm`, `vHoja`); quién: gerente y administrador (compras.corregir y recepciones.anular, DDD:187)",
});

const HOJA_DE_LA_FICHA = "apps/web/ui/plantillas/compras/proveedor/HojaDeCambioDeFicha.cliente.tsx";
const EDITAR_O_PEDIR_FICHA = ["proveedores.editar_ficha", "proveedores.pedir_ficha"] as const;
const DE_LA_FICHA_DEL_PROVEEDOR = (para: string): Proposito => ({
  para,
  fuente:
    "Pedernal-docs, brief `PR-4-ficha-del-proveedor-de-compras.md` de Compras (rama de planificación de la Ola 1) §4b y maqueta `compra.html` (modales `addpv` y `addtipo`); quién: gerente y administrador agregan, quien carga compras pide (proveedores.editar_ficha y proveedores.pedir_ficha)",
});

export const DATOS_DE_COMPRAS = {
  "precio-corregido-de-compra": {
    // El precio nuevo de una línea que ya tiene precio, como texto decimal; qué es válido (mayor que cero, hasta 6 decimales) lo decide `leerCorreccion` al correr el caso de uso: la pantalla no copia la regla.
    ficha: "src/modulos/compras/dominio/correccion.ts",
    propositos: [
      DE_CORREGIR_Y_ANULAR(
        "Precio nuevo de una línea de una compra ya hecha, en el mismo «precio por» de la línea.",
      ),
    ],
    consumidores: [FORMULARIO_DE_CORREGIR],
    ponerPor: CORREGIR_COMPRA,
    requiere: REQUIERE_COMPRAS,
  },
  "motivo-de-correccion-de-compra": {
    // La regla del motivo (1 a 500 caracteres, de una línea, con una letra) vive UNA vez en el dominio: corregir y anular usan la misma `motivoDeAnulacionDesdeTexto`.
    ficha: "src/modulos/compras/dominio/registrar-compra.ts",
    propositos: [DE_CORREGIR_Y_ANULAR("Motivo obligatorio de corregir el precio de una línea.")],
    consumidores: [FORMULARIO_DE_CORREGIR],
    ponerPor: CORREGIR_COMPRA,
    requiere: REQUIERE_COMPRAS,
  },
  "motivo-de-anulacion-de-compra": {
    ficha: "src/modulos/compras/dominio/registrar-compra.ts",
    propositos: [DE_CORREGIR_Y_ANULAR("Motivo obligatorio de anular una compra entera.")],
    consumidores: [HOJA_DE_ANULAR],
    ponerPor: ANULAR_COMPRA,
    requiere: REQUIERE_COMPRAS,
  },
  "numero-de-punto-de-venta": {
    // El rango (1 a 99998) vive UNA vez, en el dominio (`esPuntoDeVentaValido`, `PUNTO_DE_VENTA_MAXIMO`): la pantalla toma de ahí el largo del campo y el servidor vuelve a validar el número.
    ficha: "src/modulos/compras/dominio/comprobante.ts",
    propositos: [
      DE_LA_FICHA_DEL_PROVEEDOR(
        "Número del punto de venta que se agrega a la ficha de un proveedor o que se pide agregar (el pedido lo aprueba quien administra).",
      ),
    ],
    consumidores: [HOJA_DE_LA_FICHA],
    ponerPor: EDITAR_O_PEDIR_FICHA,
    requiere: REQUIERE_COMPRAS,
  },
  "tipo-de-comprobante-de-ficha": {
    // Los nueve tipos viven UNA vez, en el dominio (`TIPOS_DE_COMPROBANTE_DE_PROVEEDOR`): el servidor los ofrece y el pedido solo se acepta con uno de ellos.
    ficha: "src/modulos/compras/dominio/comprobante.ts",
    propositos: [
      DE_LA_FICHA_DEL_PROVEEDOR(
        "Tipo de comprobante (factura, nota de débito o de crédito, A, B o C) que se agrega a la ficha de un proveedor o que se pide agregar.",
      ),
    ],
    consumidores: [HOJA_DE_LA_FICHA],
    ponerPor: EDITAR_O_PEDIR_FICHA,
    requiere: REQUIERE_COMPRAS,
  },
  "nivel-de-compras": {
    // La lista de niveles que se eligen vive UNA vez en el dominio (`NIVELES_ESTANDAR_DE_COMPRA`, N1 y N2): el servidor la ofrece y el pedido solo se acepta con uno de ella.
    ficha: "src/modulos/compras/dominio/niveles.ts",
    propositos: [
      {
        para: "Nivel con el que la empresa carga sus compras: «Sin factura» o «Con factura». Rige hacia adelante: cada compra guarda el nivel con que nació.",
        fuente:
          "Pedernal-docs, brief `PR-11-nivel-de-compras-pantalla.md` de Compras (rama de planificación de la Ola 1) y maqueta `compra-nivel.html`; decisión del dueño del 23/11/2026 (pregunta 9) y orden del 24/11/2026 (solo N1 y N2); quién: solo el gerente (compras.configurar)",
      },
    ],
    consumidores: [FORMULARIO_DEL_NIVEL],
    ponerPor: ["compras.configurar"],
    requiere: REQUIERE_COMPRAS,
  },
  "producto-de-compra": {
    // Sin primitiva: es la elección de UN producto entre los que el servidor ofrece para comprar (`productosParaComprar`); la pantalla solo manda el id y el servidor vuelve a validar que sea de la empresa y comprable.
    ficha: "src/modulos/compras/casos-de-uso/lectura-para-comprar.ts",
    propositos: [
      {
        para: "Producto de un renglón de «Nueva compra», elegido buscando por nombre entre los productos que el servidor ofrece para comprar (la unidad base y, si la tiene, las presentaciones salen de ese producto).",
        fuente:
          "Pedernal-docs, brief `PR-6-nueva-compra-pantalla.md` de Compras (rama de planificación de la Ola 1) §6a y §6b (campo `producto-de-compra`, maqueta `compra.html` estado `nueva`); quién: los tres roles (recepciones.registrar)",
      },
    ],
    consumidores: [PRUEBA_DEL_BUSCADOR],
    ponerPor: REGISTRAR_COMPRA,
    requiere: REQUIERE_COMPRAS,
  },
  "estado-de-compra-de-busqueda": {
    ficha: "src/composicion/entradas-de-compras.ts",
    propositos: [
      DEL_FILTRO("Estado por el que se filtra la lista de compras: todas o sin facturar."),
    ],
    consumidores: [FORMULARIO_DE_FILTROS],
    ponerPor: VER_COMPRAS,
    requiere: REQUIERE_COMPRAS,
  },
  "fecha-desde-de-compra": {
    ficha: "src/primitivas/tiempo/fecha-civil.ts",
    propositos: [
      DEL_FILTRO(
        "Fecha de negocio desde la que se listan las compras (inclusive; vacía, sin límite).",
      ),
    ],
    consumidores: [FORMULARIO_DE_FILTROS],
    ponerPor: VER_COMPRAS,
    requiere: REQUIERE_COMPRAS,
  },
  "fecha-hasta-de-compra": {
    ficha: "src/primitivas/tiempo/fecha-civil.ts",
    propositos: [
      DEL_FILTRO(
        "Fecha de negocio hasta la que se listan las compras (inclusive; vacía, sin límite).",
      ),
    ],
    consumidores: [FORMULARIO_DE_FILTROS],
    ponerPor: VER_COMPRAS,
    requiere: REQUIERE_COMPRAS,
  },
} as const satisfies Readonly<Record<string, DefinicionDeDato>>;
