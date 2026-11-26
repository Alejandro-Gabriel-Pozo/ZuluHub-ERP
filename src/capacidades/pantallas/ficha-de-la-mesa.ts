import type { FichaDePantalla } from "./ficha-de-mesas";

/**
 * LA FICHA DE LA PANTALLA «MESA» (SAL-B, la ficha de una mesa del salón; DDD:174: toda pantalla nueva nace con ficha). Declara lo que la pantalla ofrece: ruta y archivos, el acceso, los botones con la acción de permiso
 * que cada uno envía, los estados y cada texto con SU uso y SU fuente. Misma forma que `ficha-de-mesas.ts` (el tipo se importa de ahí: una regla, un lugar) y la comprueba `ficha-de-la-mesa.test.ts` contra el catálogo
 * de textos, el de permisos y el modelo, para que no se desfase. No crea acciones ni permisos: declara los que ya existen (`cuentas.*`, `comandas.enviar`, `salon.cambiar_mesa`).
 * La hoja de producto y el buscador son los de la venta rápida (`apps/web/ui/plantillas/venta/`, con `textosDeLaVenta`); no se duplican acá. Enviar a cocina, imprimir, anular un ítem enviado, cobrar, unir y dividir
 * son de los PR que siguen (SAL-C a SAL-E2): cuando lleguen suman sus botones a esta ficha. Sin textos pendientes: «Hay platos sin pedir» (la franja sobre «Cobrar») es de SAL-D.
 * Previene: un botón o un texto que nadie aprobó, y una ruta que se mueve sin que la ficha lo note.
 */

const MAQUETA_APROBADA = {
  decidio:
    "el dueño, 09/11/2026 (aprobó la maqueta `salon.html`; Pedernal-docs 11-especificaciones/decisiones-del-dueno-2026-11.md, D115: 302 textos)",
  donde:
    "Pedernal-docs 10-ux-ui, maqueta salon.html (grupo «Mesa y pedido») y 11-especificaciones/salon-dia-uno-inventario-de-textos.md, sección A.1",
} as const;
const ORDEN_DE_SALIDA = {
  decidio:
    "el dueño, 09/11/2026 (aprobó la maqueta `salida.html`; Pedernal-docs 11-especificaciones/decisiones-del-dueno-2026-11.md, D115: 302 textos)",
  donde:
    "Pedernal-docs 10-ux-ui, maqueta salida.html (tabla «Sale ahora · Sale después · Cuándo sale», aprobada el 09/11/2026) y 11-especificaciones/salon-dia-uno-inventario-de-textos.md, sección A.1",
} as const;
const COMANDA_APROBADA = {
  decidio:
    "el dueño, 09/11/2026 (aprobó la maqueta `salon.html`; Pedernal-docs 11-especificaciones/decisiones-del-dueno-2026-11.md, D115: 302 textos)",
  donde:
    "Pedernal-docs 10-ux-ui, maqueta salon.html (grupos «Cocina e impresión» y «Anular») y 11-especificaciones/salon-dia-uno-inventario-de-textos.md, sección A.2",
} as const;
const COPIA_APROBADA = {
  decidio:
    "el dueño, 09/11/2026 (aprobó la maqueta `imprimir.html`; Pedernal-docs 11-especificaciones/decisiones-del-dueno-2026-11.md, D115: 302 textos)",
  donde:
    "Pedernal-docs 10-ux-ui, maqueta imprimir.html (CYN 120) y 11-especificaciones/salon-dia-uno-inventario-de-textos.md, sección A.2",
} as const;
const UNIR_APROBADO = {
  decidio:
    "el dueño, 09/11/2026 (aprobó la maqueta `unir.html`; D115: 302 textos), y el recorrido del salón con «Unir», 25/11/2026 (fila 444 de decisiones-del-dueno-2026-11.md)",
  donde:
    "Pedernal-docs 10-ux-ui, maqueta unir.html y 11-especificaciones/briefs/salon/SAL-E1-unir-mesas.md §3 (S10)",
} as const;
const USO_DE_IMPRIMIR = "BotonDeImprimir.cliente.tsx";
const USO_DEL_MODELO = "modelo-de-la-mesa.ts (ficha de la mesa)";
const USO_DE_LA_PANTALLA = "PantallaDeLaMesa.cliente.tsx";

export const FICHA_DE_LA_MESA = {
  archivos: [
    "apps/web/app/s/app/(operacion)/salon/cuenta/[mesaId]/page.tsx",
    "apps/web/app/s/app/acciones-de-salon.ts",
    "apps/web/ui/plantillas/salon/PantallaDeLaMesa.cliente.tsx",
    "apps/web/ui/plantillas/salon/CatalogoDeLaMesa.cliente.tsx",
    "apps/web/ui/plantillas/salon/modelo-de-la-mesa.ts",
    "apps/web/ui/plantillas/salon/PlatoDeLaMesa.cliente.tsx",
    "apps/web/ui/plantillas/salon/useCocinaDeLaMesa.cliente.tsx",
    "apps/web/ui/plantillas/salon/ImpresionDelDocumento.cliente.tsx",
    "apps/web/ui/plantillas/salon/HojaDeAnularItem.cliente.tsx",
    "apps/web/ui/plantillas/salon/EnviosDeLaMesa.cliente.tsx",
    "apps/web/ui/plantillas/salon/AccionesDeLaMesa.cliente.tsx",
    "apps/web/ui/plantillas/salon/UnirLaMesa.cliente.tsx",
    "apps/web/ui/plantillas/salon/HojaDeUnir.cliente.tsx",
    "apps/web/ui/plantillas/salon/HojaDeCambiarDeMesa.cliente.tsx",
    "apps/web/ui/plantillas/salon/CobroDeLaMesa.cliente.tsx",
    "apps/web/app/s/app/(operacion)/salon/cuenta/[mesaId]/cobrar/page.tsx",
    "apps/web/ui/patrones/papel/BotonDeImprimir.cliente.tsx",
  ],
  rutas: ["/salon/cuenta/[mesaId]", "/salon/cuenta/[mesaId]/cobrar"],
  titulo: "salon.texto.admin_mesa_numero",
  acceso: "mesas.ver",
  botones: [
    {
      id: "tomar-pedido",
      texto: "salon.texto.mesa_tomar_pedido",
      hace: { envia: "cuentas.abrir" },
      sinPermiso: "APAGADO",
    },
    {
      id: "agregar",
      texto: "ventas.venta.agregar",
      hace: { envia: "cuentas.agregar_linea" },
      sinPermiso: "APAGADO",
    },
    {
      id: "salida",
      texto: "comandas.texto.salida_cuando_sale",
      hace: { envia: "cuentas.agregar_linea" },
      sinPermiso: "APAGADO",
    },
    {
      id: "quitar",
      texto: "comandas.texto.salida_quitar",
      hace: { envia: "cuentas.anular_linea" },
      sinPermiso: "APAGADO",
    },
    {
      id: "enviar-a-cocina",
      texto: "comandas.texto.envio_enviar_a_cocina",
      hace: { envia: "comandas.enviar" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "pedir-que-salga",
      texto: "comandas.texto.salida_pedir_que_salga",
      hace: { envia: "comandas.enviar" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "pedir-que-salga-todo",
      texto: "comandas.texto.salida_pedir_que_salga_todo",
      hace: { envia: "comandas.enviar" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "anular-item-enviado",
      texto: "comandas.texto.anulacion_anular",
      hace: { envia: "cuentas.anular_linea" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "imprimir",
      texto: "comandas.texto.imprimir_imprimir",
      hace: { envia: "impresiones.imprimir" },
      sinPermiso: "APAGADO",
    },
    {
      id: "reimprimir",
      texto: "comandas.texto.envio_reimprimir",
      hace: { envia: "impresiones.reimprimir" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "cobrar",
      texto: "ventas.cobro.cobrar",
      hace: { envia: "tickets.cobrar" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "unir",
      texto: "salon.texto.unir_unir_con_otra_mesa",
      hace: { envia: "salon.unir" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "confirmar-union",
      texto: "salon.texto.unir_unir_ahora",
      hace: { envia: "salon.unir" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "liberar",
      texto: "salon.texto.mesa_liberar_mesa",
      hace: { envia: "cuentas.anular" },
      sinPermiso: "APAGADO",
    },
    {
      id: "cambiar-de-mesa",
      texto: "salon.texto.mesa_cambiar_de_mesa",
      hace: { envia: "salon.cambiar_mesa" },
      sinPermiso: "AUSENTE",
    },
  ],
  estados: { ERROR: "GENERICO", SIN_PERMISO: "GENERICO" },
  textos: {
    "salon.texto.admin_mesa_numero": {
      usos: ["título de la pantalla («Mesa 7»)", USO_DEL_MODELO],
      fuente: {
        decidio:
          "el dueño, 09/11/2026 (maqueta `mesas.html`, rótulo de cada tarjeta; el mismo «Mesa 5» del papel de la comanda)",
        donde: "Pedernal-docs 10-ux-ui, maqueta mesas.html, función `vLista`",
      },
    },
    "salon.texto.mesa_mesa_libre": { usos: [USO_DE_LA_PANTALLA], fuente: MAQUETA_APROBADA },
    "salon.texto.mesa_tomar_pedido": { usos: [USO_DE_LA_PANTALLA], fuente: MAQUETA_APROBADA },
    "salon.texto.mesa_la_mesa_no_tiene_pedido": {
      usos: [USO_DE_LA_PANTALLA],
      fuente: MAQUETA_APROBADA,
    },
    "salon.texto.mesa_liberar_mesa": { usos: [USO_DE_LA_PANTALLA], fuente: MAQUETA_APROBADA },
    "salon.texto.mesa_cambiar_de_mesa": { usos: [USO_DE_LA_PANTALLA], fuente: MAQUETA_APROBADA },
    "salon.texto.mesa_pasar_a_la_mesa": {
      usos: ["título de la hoja de cambio de mesa"],
      fuente: MAQUETA_APROBADA,
    },
    "salon.texto.mesa_no_hay_mesas_libres": {
      usos: ["hoja de cambio de mesa sin destinos"],
      fuente: MAQUETA_APROBADA,
    },
    ...Object.fromEntries(
      [
        "salon.texto.unir_unir_con_otra_mesa",
        "salon.texto.unir_unir_ahora",
        "salon.texto.unir_cuanto_queda",
        "salon.texto.unir_esto_no_se_deshace_para_separar_se_divide_la_cuent",
        "salon.texto.unir_no_se_pueden_unir",
        "salon.texto.unir_mesa_libre",
        "salon.texto.unir_la_mesa_ya_tiene_un_cobro",
      ].map((clave) => [
        clave,
        { usos: ["hoja de «Unir con otra mesa» (SAL-E1)", USO_DEL_MODELO], fuente: UNIR_APROBADO },
      ]),
    ),
    "ventas.cobro.cobrar": {
      usos: [
        "botón «Cobrar» de la ficha de la mesa (lleva a la hoja de cobro de la mesa: la de la venta rápida en modo «cuenta existente», descrita en `ficha-de-cobrar.ts`)",
        USO_DEL_MODELO,
      ],
      fuente: {
        decidio:
          "el dueño, 09/11/2026 (aprobó «Cobrar» en `salon.html:361` y la versión anterior de la venta rápida); el recorrido del salón (maqueta con «Cobrar la mesa»), 25/11/2026 (fila 444 de decisiones-del-dueno-2026-11.md)",
        donde:
          "Pedernal-docs 10-ux-ui, maqueta salon.html (`salon.html:361`) y 11-especificaciones/briefs/salon/SAL-D-cobro-de-mesa.md §3 (S8)",
      },
    },
    "ventas.venta.agregar": {
      usos: [
        "título de la lista de productos para agregar",
        "hoja de producto (la de la venta rápida)",
      ],
      fuente: {
        decidio: "el dueño, 09/11/2026 (aprobó la maqueta de la venta rápida; D115)",
        donde:
          "Pedernal-docs 10-ux-ui, maqueta venta-rapida-v4.html y 11-especificaciones/salon-dia-uno-inventario-de-textos.md, sección A.1",
      },
    },
    "ventas.venta.total": {
      usos: ["total de la cuenta de la mesa"],
      fuente: {
        decidio: "el dueño, 09/11/2026 (aprobó la maqueta de la venta rápida; D115)",
        donde: "Pedernal-docs 10-ux-ui, maqueta venta-rapida-v4.html (la barra «Total»)",
      },
    },
    "ventas.venta.cancelar": {
      usos: ["texto de la hoja de producto (la de la venta rápida)"],
      fuente: {
        decidio: "el dueño, 09/11/2026 (aprobó la maqueta de la venta rápida; D115)",
        donde: "Pedernal-docs 10-ux-ui, maqueta venta-rapida-v4.html (hoja de producto)",
      },
    },
    "vidriera.producto.cerrar": {
      usos: ["botón de cerrar de las hojas"],
      fuente: {
        decidio: "el dueño, 09/11/2026 (aprobó la maqueta de la venta rápida; D115)",
        donde: "Pedernal-docs 10-ux-ui, maqueta venta-rapida-v4.html (hoja de producto)",
      },
    },
    "comandas.texto.salida_sale_ahora": { usos: [USO_DE_LA_PANTALLA], fuente: ORDEN_DE_SALIDA },
    "comandas.texto.salida_sale_despues": { usos: [USO_DE_LA_PANTALLA], fuente: ORDEN_DE_SALIDA },
    "comandas.texto.salida_cuando_sale": { usos: [USO_DE_LA_PANTALLA], fuente: ORDEN_DE_SALIDA },
    "comandas.texto.salida_para_enviar": { usos: [USO_DEL_MODELO], fuente: ORDEN_DE_SALIDA },
    "comandas.texto.salida_esperan_para_despues": {
      usos: [USO_DEL_MODELO],
      fuente: ORDEN_DE_SALIDA,
    },
    "comandas.texto.salida_enviadas": { usos: [USO_DEL_MODELO], fuente: ORDEN_DE_SALIDA },
    "comandas.texto.salida_quitar": { usos: [USO_DE_LA_PANTALLA], fuente: ORDEN_DE_SALIDA },
    "comandas.texto.envio_envio_n": {
      usos: ["número de envío de un plato enviado («Envío 1»)"],
      fuente: MAQUETA_APROBADA,
    },
    "comandas.texto.envio_enviar_a_cocina": {
      usos: [USO_DE_LA_PANTALLA],
      fuente: COMANDA_APROBADA,
    },
    "comandas.texto.envio_enviado_a_cocina": {
      usos: ["texto de la ficha (confirmación del envío)"],
      fuente: COMANDA_APROBADA,
    },
    "comandas.texto.envio_reimprimir": { usos: [USO_DE_LA_PANTALLA], fuente: COMANDA_APROBADA },
    "comandas.texto.envio_item_anulado": {
      usos: ["título del aviso de un ítem anulado"],
      fuente: COMANDA_APROBADA,
    },
    "comandas.texto.salida_pedir_que_salga": {
      usos: [USO_DE_LA_PANTALLA],
      fuente: ORDEN_DE_SALIDA,
    },
    "comandas.texto.salida_pedir_que_salga_todo": {
      usos: [USO_DE_LA_PANTALLA],
      fuente: ORDEN_DE_SALIDA,
    },
    "comandas.texto.anulacion_anular": { usos: [USO_DE_LA_PANTALLA], fuente: COMANDA_APROBADA },
    "comandas.texto.anulacion_motivo": { usos: [USO_DE_LA_PANTALLA], fuente: COMANDA_APROBADA },
    "ventas.venta.cantidad": {
      usos: ["cantidad que se anula (hoja de anular un ítem enviado)"],
      fuente: {
        decidio: "el dueño, 09/11/2026 (aprobó la maqueta de la venta rápida; D115)",
        donde:
          "Pedernal-docs 10-ux-ui, maqueta venta-rapida-v4.html (hoja de producto, campo de cantidad)",
      },
    },
    "comandas.texto.imprimir_se_imprime_una_copia_con_la_hora_del_envio_origina": {
      usos: ["hoja que confirma una copia del papel"],
      fuente: COPIA_APROBADA,
    },
    "comandas.texto.imprimir_configurar_impresoras": {
      usos: ["enlace cuando no hay impresora para la comanda de cocina"],
      fuente: COPIA_APROBADA,
    },
    "comandas.texto.imprimir_imprimir": { usos: [USO_DE_IMPRIMIR], fuente: COPIA_APROBADA },
    "comandas.texto.imprimir_imprimiendo": { usos: [USO_DE_IMPRIMIR], fuente: COPIA_APROBADA },
    "comandas.texto.imprimir_impresa": { usos: [USO_DE_IMPRIMIR], fuente: COPIA_APROBADA },
    "comandas.texto.imprimir_no_se_pudo_imprimir": {
      usos: [USO_DE_IMPRIMIR],
      fuente: COPIA_APROBADA,
    },
    "comandas.texto.imprimir_reintentar": { usos: [USO_DE_IMPRIMIR], fuente: COPIA_APROBADA },
    "comandas.texto.imprimir_ver_en_pantalla": { usos: [USO_DE_IMPRIMIR], fuente: COPIA_APROBADA },
    "comandas.texto.imprimir_no_hay_impresora_para_la_comanda_de_cocina": {
      usos: [USO_DE_IMPRIMIR],
      fuente: COPIA_APROBADA,
    },
    "salon.texto.unir_unida_a_la_mesa": {
      usos: ["estado de una mesa unida («Unida a la mesa 5»)"],
      fuente: {
        decidio:
          "el dueño, 09/11/2026 (aprobó la maqueta `unir.html`; D115) y decisión 116 sobre unir mesas",
        donde:
          "Pedernal-docs 10-ux-ui, maqueta unir.html y 11-especificaciones/salon-dia-uno-inventario-de-textos.md, sección A.3",
      },
    },
    "salon.texto.unir_de_la_mesa": {
      usos: ["origen de un plato que vino de otra mesa por una unión («De la mesa 3»)"],
      fuente: {
        decidio:
          "el dueño, 09/11/2026 (aprobó la maqueta `unir.html`; D115) y decisión 116 sobre unir mesas",
        donde:
          "Pedernal-docs 10-ux-ui, maqueta unir.html y 11-especificaciones/salon-dia-uno-inventario-de-textos.md, sección A.3",
      },
    },
    "salon.texto.unir_compartido": {
      usos: ["plato compartido entre cuentas"],
      fuente: {
        decidio: "el dueño, 09/11/2026 (aprobó la maqueta `unir.html`; D115, CYN 117)",
        donde:
          "Pedernal-docs 10-ux-ui, maqueta unir.html y 11-especificaciones/salon-dia-uno-inventario-de-textos.md, sección A.3",
      },
    },
    "salon.texto.dividir_cuenta_n": {
      usos: ["cuentas de una mesa dividida («Cuenta 1 · $ 100,00»)"],
      fuente: {
        decidio:
          "el dueño, 09/11/2026 (aprobó las maquetas `salon.html` y `unir.html`; D115, CYN 89 y 90)",
        donde:
          "Pedernal-docs 10-ux-ui, maqueta salon.html (grupo «Dividir») y 11-especificaciones/salon-dia-uno-inventario-de-textos.md, sección A.3",
      },
    },
  },
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDePantalla;
