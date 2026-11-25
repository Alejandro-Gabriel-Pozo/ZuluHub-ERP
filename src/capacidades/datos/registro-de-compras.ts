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

/** El mismo período aplicado en la lista es el que baja el enlace «Exportar» (dueño, 25/11/2026; no hay campos propios de la exportación). */
const DE_LA_EXPORTACION = (para: string): Proposito => ({
  para,
  fuente:
    "Pedernal-docs/11-especificaciones/plan-exportacion-de-compras-2026-11-25.md §2 y §6 (el enlace «Exportar» usa el período aplicado de la lista); dueño, 25/11/2026: «Sí a todas tus recomendaciones» (pregunta 5 del diseño: el período de la Cabecera es la fecha del comprobante si hay, si no la de negocio; el del Detalle, la de negocio)",
});

const PRUEBA_DEL_BUSCADOR = "apps/web/ui/componentes/BuscadorEnLista.test.tsx";
const PRUEBA_DE_LA_LECTURA = "apps/web/ui/plantillas/compras/nueva/useLecturaDemorada.test.tsx";
const PANTALLA_DE_NUEVA_COMPRA =
  "apps/web/ui/plantillas/compras/nueva/PantallaDeNuevaCompra.cliente.tsx";
const TARJETA_DE_RENGLON = "apps/web/ui/plantillas/compras/nueva/TarjetaDeRenglon.cliente.tsx";
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

const PANTALLA_DE_CARGAR_FACTURA =
  "apps/web/ui/plantillas/compras/facturas/PantallaDeCargarFactura.cliente.tsx";
const PANTALLA_DE_CONCILIAR =
  "apps/web/ui/plantillas/compras/facturas/PantallaDeConciliar.cliente.tsx";
const CARGAR_FACTURA = ["comprobantes_de_proveedor.registrar"] as const;
const CONCILIAR_FACTURA = ["conciliaciones.conciliar"] as const;
const DE_FACTURAS = (para: string): Proposito => ({
  para,
  fuente:
    "Pedernal-docs, maqueta `compra-conciliar.html` (estados `cargar` y `conciliar`) y `plan-de-pantallas-compras-4-2026-11-25.md` (fichas F5 y F7); quién: los tres roles cargan la factura (`comprobantes_de_proveedor.registrar`) y gerente y administrador concilian (`conciliaciones.conciliar`, DEC-0700); aceptada por delegación de pantallas (DEC-0936)",
});

const ACCIONES_DE_LA_RECEPCION =
  "apps/web/ui/plantillas/compras/recepciones/AccionesDeLaRecepcion.cliente.tsx";
const DE_RECEPCIONES = (para: string): Proposito => ({
  para,
  fuente:
    "Pedernal-docs, maqueta `compra-recibir.html` (estados «Por confirmar» y «Varios depósitos») y `plan-de-pantallas-compras-4-2026-11-25.md` (ficha F3); quién: gerente y administrador (`recepciones.confirmar` y `recepciones.anular`, DEC-0904); aceptada por delegación de pantallas (DEC-0907)",
});

const CORREGIR_LO_RECIBIDO =
  "apps/web/ui/plantillas/compras/recepciones/CorregirLoRecibido.cliente.tsx";
const DE_CORREGIR_LO_RECIBIDO = (para: string): Proposito => ({
  para,
  fuente:
    "Decisión del dueño del 25/11/2026 (chat del orquestador, a asentar en `decisiones-del-dueno-2026-11.md`): se corrige lo recibido con un registro nuevo, el motivo es una lista corta (error de carga, reparto interno, faltante del proveedor) más una nota opcional y corrigen gerente y administrador (`compras.corregir`); maqueta «Tomar el costo» (Artifact privado, estado «Corregir», DEC-0937 y DEC-0938).",
});

const HOJA_DE_ANULAR_PAGO = "apps/web/ui/plantillas/compras/pago/HojaDeAnularPago.cliente.tsx";
const ANULAR_PAGO = ["comprobantes_de_proveedor.anular_pago"] as const;
const DE_ANULAR_UN_PAGO = (para: string): Proposito => ({
  para,
  fuente:
    "Pedernal-docs, brief `PR-8-pago-de-una-factura.md` de Compras (rama de planificación de la Ola 1) y maqueta `compra-pago.html` (estado «Anular el pago», aceptada por delegación, DDD:187); quién: gerente y administrador (comprobantes_de_proveedor.anular_pago)",
});

const HOJA_DE_LA_FICHA = "apps/web/ui/plantillas/compras/proveedor/HojaDeCambioDeFicha.cliente.tsx";
const EDITAR_O_PEDIR_FICHA = ["proveedores.editar_ficha", "proveedores.pedir_ficha"] as const;
const DE_LA_FICHA_DEL_PROVEEDOR = (para: string): Proposito => ({
  para,
  fuente:
    "Pedernal-docs, brief `PR-4-ficha-del-proveedor-de-compras.md` de Compras (rama de planificación de la Ola 1) §4b y maqueta `compra.html` (modales `addpv` y `addtipo`); quién: gerente y administrador agregan, quien carga compras pide (proveedores.editar_ficha y proveedores.pedir_ficha)",
});
const FUENTE_DE_NUEVA_COMPRA =
  "Pedernal-docs, brief `PR-6-nueva-compra-pantalla.md` de Compras (rama de planificación de la Ola 1) §6b, maqueta `compra.html` (estados `nueva`, `como`, `remito`; aprobada el 09/11/2026) y plan `compras-siguientes-tramos-2026-11-23.md` §4 (respuestas del dueño del 23/11/2026, filas 6 y 7: compra en la unidad base y cotización antes de guardar); quién: los tres roles (recepciones.registrar)";
const DE_NUEVA_COMPRA = (para: string): Proposito => ({ para, fuente: FUENTE_DE_NUEVA_COMPRA });
const FUENTE_CON_PRESENTACIONES =
  "Pedernal-docs, `decisiones-del-dueno-2026-11.md` fila del 25/11/2026 («Presentaciones en Catálogo (T0): … «Nueva compra» con presentaciones va aparte (T0b)»), maqueta `compra.html` (estados `nueva` y `como`, aprobada el 09/11/2026) y respuestas del orquestador del 25/11/2026 (peso variable con «Peso recibido» y «Precio por» la presentación); quién: los tres roles (recepciones.registrar)";
const CON_PRESENTACIONES = (para: string): Proposito => ({
  para,
  fuente: FUENTE_CON_PRESENTACIONES,
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
    propositos: [
      DE_CORREGIR_Y_ANULAR("Motivo obligatorio de anular una compra entera."),
      DE_ANULAR_UN_PAGO("Motivo obligatorio de anular el pago de una factura."),
      DE_RECEPCIONES(
        "Motivo obligatorio de anular una recepción que todavía está «Por confirmar».",
      ),
    ],
    consumidores: [HOJA_DE_ANULAR, HOJA_DE_ANULAR_PAGO, ACCIONES_DE_LA_RECEPCION],
    ponerPor: [...ANULAR_COMPRA, ...ANULAR_PAGO],
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
      DE_NUEVA_COMPRA(
        "Producto de un renglón de «Nueva compra», elegido buscando por nombre entre los productos que el servidor ofrece para comprar (la unidad base sale de ese producto).",
      ),
      DE_FACTURAS(
        "Producto de cada línea de la factura de la empresa («Cargar factura»), elegido buscando por nombre entre los productos que el servidor ofrece para comprar: con él se propone la conciliación.",
      ),
    ],
    consumidores: [
      PANTALLA_DE_NUEVA_COMPRA,
      PANTALLA_DE_CARGAR_FACTURA,
      PRUEBA_DEL_BUSCADOR,
      PRUEBA_DE_LA_LECTURA,
    ],
    ponerPor: [...REGISTRAR_COMPRA, ...CARGAR_FACTURA],
    requiere: REQUIERE_COMPRAS,
  },
  "proveedor-de-compra": {
    // Sin primitiva: es la elección de UN proveedor entre los del directorio; el servidor vuelve a validar que exista, sea de la empresa y tenga el rol (`PROVEEDOR_NO_ENCONTRADO`).
    ficha: "src/modulos/compras/casos-de-uso/registrar-compra.ts",
    propositos: [
      DE_NUEVA_COMPRA(
        "Proveedor de la compra, elegido buscando por nombre entre los proveedores del directorio (o agregado en el momento).",
      ),
      DE_FACTURAS(
        "Proveedor de la factura de la empresa, elegido buscando por nombre entre los proveedores del directorio.",
      ),
    ],
    consumidores: [PANTALLA_DE_NUEVA_COMPRA, PANTALLA_DE_CARGAR_FACTURA],
    ponerPor: [...REGISTRAR_COMPRA, ...CARGAR_FACTURA],
    requiere: REQUIERE_COMPRAS,
  },
  "deposito-de-compra": {
    ficha: "src/modulos/compras/dominio/registrar-compra.ts",
    propositos: [
      DE_NUEVA_COMPRA(
        "Depósito donde entra la mercadería, solo cuando la sucursal tiene más de un depósito de uso normal (con uno solo, el servidor lo toma sin preguntar).",
      ),
      DE_RECEPCIONES(
        "Depósito donde entra la mercadería de una recepción al confirmarla, solo cuando la sucursal tiene más de un depósito de uso normal.",
      ),
    ],
    consumidores: [PANTALLA_DE_NUEVA_COMPRA, ACCIONES_DE_LA_RECEPCION],
    ponerPor: [...REGISTRAR_COMPRA, "recepciones.confirmar"],
    requiere: REQUIERE_COMPRAS,
  },
  "cantidad-a-conciliar-de-linea": {
    // La cantidad es la misma de todo el módulo (hasta 4 decimales, mayor que cero, en la unidad de stock): la regla vive UNA vez en `decimal.ts` y el servidor la vuelve a aplicar con los topes (no más de lo recibido ni de lo facturado).
    ficha: "src/modulos/compras/dominio/decimal.ts",
    propositos: [
      DE_FACTURAS(
        "Cuánto de una línea recibida de una sucursal cubre una línea de la factura (precargada con la propuesta; la persona la deja o la corrige).",
      ),
    ],
    consumidores: [PANTALLA_DE_CONCILIAR],
    ponerPor: CONCILIAR_FACTURA,
    requiere: REQUIERE_COMPRAS,
  },
  "cantidad-recibida-corregida": {
    // La cantidad es la misma de todo el módulo (hasta 4 decimales, mayor que cero, en la unidad de stock): la regla vive UNA vez en `decimal.ts` y el servidor la vuelve a aplicar con el tope de lo conciliado y la existencia.
    ficha: "src/modulos/compras/dominio/decimal.ts",
    propositos: [
      DE_CORREGIR_LO_RECIBIDO(
        "La cantidad que de verdad llegó de una línea de una recepción confirmada, en la unidad de stock; reemplaza a la vigente con un registro de corrección.",
      ),
    ],
    consumidores: [CORREGIR_LO_RECIBIDO],
    ponerPor: CORREGIR_COMPRA,
    requiere: REQUIERE_COMPRAS,
  },
  "causa-de-correccion-de-lo-recibido": {
    // Las tres causas viven UNA vez, en el dominio (`CAUSAS_DE_CORRECCION`): la pantalla las ofrece y el servidor solo acepta una de ellas (la base repite la lista con una prueba que falla si difieren).
    ficha: "src/modulos/compras/dominio/correccion-de-lo-recibido.ts",
    propositos: [
      DE_CORREGIR_LO_RECIBIDO(
        "Por qué se corrige lo recibido: error de carga, reparto interno o faltante del proveedor (separa en los reportes lo que se le reclama al proveedor de lo que no).",
      ),
    ],
    consumidores: [CORREGIR_LO_RECIBIDO],
    ponerPor: CORREGIR_COMPRA,
    requiere: REQUIERE_COMPRAS,
  },
  "nota-de-correccion-de-lo-recibido": {
    // El largo máximo y el conjunto permitido viven UNA vez, en el dominio (`MAXIMO_DE_LA_NOTA_DE_CORRECCION`, `leerCorreccionDeLoRecibido`); el servidor vuelve a validar.
    ficha: "src/modulos/compras/dominio/correccion-de-lo-recibido.ts",
    propositos: [
      DE_CORREGIR_LO_RECIBIDO("Nota opcional de una línea corregida, de una sola línea."),
    ],
    consumidores: [CORREGIR_LO_RECIBIDO],
    ponerPor: CORREGIR_COMPRA,
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
      CON_PRESENTACIONES(
        "Con presentaciones activas en el producto, el mismo selector ofrece también cada presentación («caja de 12»): es una forma de comprar con su cantidad fija en la unidad base; el servidor comprueba que sea del producto y activa.",
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
  "peso-recibido-de-compra": {
    ficha: "src/primitivas/cantidad/cantidad.ts",
    propositos: [
      CON_PRESENTACIONES(
        "Peso real de lo que se recibe, en la unidad base, cuando se compra una presentación de peso variable (una caja de carne no pesa siempre lo mismo): es lo que entra al stock y se costea, no el aproximado; con una presentación de peso fijo no corresponde.",
      ),
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
      CON_PRESENTACIONES(
        "Con una presentación elegida, el proveedor también puede cobrar por la presentación («$ 12.000 la caja»): el precio se multiplica por la cantidad de presentaciones.",
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
      DE_LA_EXPORTACION(
        "Primer día del período del archivo de Excel (inclusive): fecha del comprobante en la Cabecera, fecha de negocio en el Detalle.",
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
      DE_LA_EXPORTACION(
        "Último día del período del archivo de Excel (inclusive): fecha del comprobante en la Cabecera, fecha de negocio en el Detalle.",
      ),
    ],
    consumidores: [FORMULARIO_DE_FILTROS],
    ponerPor: VER_COMPRAS,
    requiere: REQUIERE_COMPRAS,
  },
} as const satisfies Readonly<Record<string, DefinicionDeDato>>;
