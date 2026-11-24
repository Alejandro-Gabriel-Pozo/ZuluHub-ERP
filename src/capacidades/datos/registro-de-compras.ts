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
const PRUEBA_DE_LA_LECTURA = "apps/web/ui/plantillas/compras/nueva/useLecturaDemorada.test.tsx";
const PANTALLA_DE_NUEVA_COMPRA =
  "apps/web/ui/plantillas/compras/nueva/PantallaDeNuevaCompra.cliente.tsx";
const TARJETA_DE_RENGLON = "apps/web/ui/plantillas/compras/nueva/TarjetaDeRenglon.cliente.tsx";
const REGISTRAR_COMPRA = ["recepciones.registrar"] as const;

const FUENTE_DE_NUEVA_COMPRA =
  "Pedernal-docs, brief `PR-6-nueva-compra-pantalla.md` de Compras (rama de planificación de la Ola 1) §6b, maqueta `compra.html` (estados `nueva`, `como`, `remito`; aprobada el 09/11/2026) y plan `compras-siguientes-tramos-2026-11-23.md` §4 (respuestas del dueño del 23/11/2026, filas 6 y 7: compra en la unidad base y cotización antes de guardar); quién: los tres roles (recepciones.registrar)";
const DE_NUEVA_COMPRA = (para: string): Proposito => ({ para, fuente: FUENTE_DE_NUEVA_COMPRA });

export const DATOS_DE_COMPRAS = {
  "producto-de-compra": {
    // Sin primitiva: es la elección de UN producto entre los que el servidor ofrece para comprar (`productosParaComprar`); la pantalla solo manda el id y el servidor vuelve a validar que sea de la empresa y comprable.
    ficha: "src/modulos/compras/casos-de-uso/lectura-para-comprar.ts",
    propositos: [
      DE_NUEVA_COMPRA(
        "Producto de un renglón de «Nueva compra», elegido buscando por nombre entre los productos que el servidor ofrece para comprar (la unidad base sale de ese producto).",
      ),
    ],
    consumidores: [PANTALLA_DE_NUEVA_COMPRA, PRUEBA_DEL_BUSCADOR, PRUEBA_DE_LA_LECTURA],
    ponerPor: REGISTRAR_COMPRA,
    requiere: REQUIERE_COMPRAS,
  },
  "proveedor-de-compra": {
    // Sin primitiva: es la elección de UN proveedor entre los del directorio; el servidor vuelve a validar que exista, sea de la empresa y tenga el rol (`PROVEEDOR_NO_ENCONTRADO`).
    ficha: "src/modulos/compras/casos-de-uso/registrar-compra.ts",
    propositos: [
      DE_NUEVA_COMPRA(
        "Proveedor de la compra, elegido buscando por nombre entre los proveedores del directorio (o agregado en el momento).",
      ),
    ],
    consumidores: [PANTALLA_DE_NUEVA_COMPRA],
    ponerPor: REGISTRAR_COMPRA,
    requiere: REQUIERE_COMPRAS,
  },
  "deposito-de-compra": {
    ficha: "src/modulos/compras/dominio/registrar-compra.ts",
    propositos: [
      DE_NUEVA_COMPRA(
        "Depósito donde entra la mercadería, solo cuando la sucursal tiene más de un depósito de uso normal (con uno solo, el servidor lo toma sin preguntar).",
      ),
    ],
    consumidores: [PANTALLA_DE_NUEVA_COMPRA],
    ponerPor: REGISTRAR_COMPRA,
    requiere: REQUIERE_COMPRAS,
  },
  "punto-de-venta-del-remito": {
    ficha: "src/modulos/compras/dominio/comprobante.ts",
    propositos: [
      DE_NUEVA_COMPRA(
        "Punto de venta del remito que trae la mercadería (opcional, junto con el número y la fecha).",
      ),
    ],
    consumidores: [PANTALLA_DE_NUEVA_COMPRA],
    ponerPor: REGISTRAR_COMPRA,
    requiere: REQUIERE_COMPRAS,
  },
  "numero-del-remito": {
    ficha: "src/modulos/compras/dominio/comprobante.ts",
    propositos: [DE_NUEVA_COMPRA("Número del remito que trae la mercadería (opcional).")],
    consumidores: [PANTALLA_DE_NUEVA_COMPRA],
    ponerPor: REGISTRAR_COMPRA,
    requiere: REQUIERE_COMPRAS,
  },
  "fecha-del-remito": {
    ficha: "src/primitivas/tiempo/fecha-civil.ts",
    propositos: [DE_NUEVA_COMPRA("Fecha impresa en el remito que trae la mercadería (opcional).")],
    consumidores: [PANTALLA_DE_NUEVA_COMPRA],
    ponerPor: REGISTRAR_COMPRA,
    requiere: REQUIERE_COMPRAS,
  },
  "unidad-de-compra": {
    ficha: "src/primitivas/unidades/unidades.ts",
    propositos: [
      DE_NUEVA_COMPRA(
        "Unidad en que se cuenta lo que se compra («Cómo se compra»): la unidad base del producto o otra de su misma dimensión; las de otra dimensión no se pueden elegir.",
      ),
    ],
    consumidores: [TARJETA_DE_RENGLON],
    ponerPor: REGISTRAR_COMPRA,
    requiere: REQUIERE_COMPRAS,
  },
  "cantidad-de-compra": {
    ficha: "src/primitivas/cantidad/cantidad.ts",
    propositos: [
      DE_NUEVA_COMPRA("Cantidad comprada de un producto, en la unidad de compra elegida."),
    ],
    consumidores: [TARJETA_DE_RENGLON],
    ponerPor: REGISTRAR_COMPRA,
    requiere: REQUIERE_COMPRAS,
  },
  "unidad-de-precio-de-compra": {
    ficha: "src/primitivas/unidades/unidades.ts",
    propositos: [
      DE_NUEVA_COMPRA(
        "Unidad por la que cobra el proveedor («Precio por»): la unidad base del producto u otra de su misma dimensión.",
      ),
    ],
    consumidores: [TARJETA_DE_RENGLON],
    ponerPor: REGISTRAR_COMPRA,
    requiere: REQUIERE_COMPRAS,
  },
  "precio-de-compra": {
    ficha: "src/primitivas/dinero/importe.ts",
    propositos: [
      DE_NUEVA_COMPRA(
        "Precio que cobra el proveedor por la unidad elegida, en pesos (vacío es «Sin precio», nunca cero).",
      ),
    ],
    consumidores: [TARJETA_DE_RENGLON],
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
