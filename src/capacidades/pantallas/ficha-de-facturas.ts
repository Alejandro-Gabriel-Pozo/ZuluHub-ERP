import type { ClaveAccion } from "../modulos/catalogo";
import type { ClaveDeTexto } from "../vocabulario/catalogo";

/**
 * LA FICHA DE LAS PANTALLAS «FACTURAS» (DDD:174: toda pantalla nueva nace con ficha; Compras 4, la factura de la empresa y su conciliación, PR B). Cuatro rutas: la lista de facturas (`/compras/facturas`), «Cargar factura»
 * (`/compras/facturas/nueva`), el detalle de una factura con sus conciliaciones y «Anular conciliación» (`/compras/facturas/[id]`) y «Conciliar» (`/compras/facturas/[id]/conciliar`). La comprueba
 * `test/web/ficha-de-facturas.test.ts` contra el catálogo de textos, el de permisos y la tabla del menú. No crea acciones ni permisos. Previene: un botón o un texto que nadie aprobó, y una ruta o una fila de menú que se
 * mueve sin que la ficha lo note.
 *
 * DIFERENCIAS CON LA MAQUETA (`compra-conciliar.html`; la maqueta manda: cada desvío lleva su fundamento y lo decide el dueño, DDD:294):
 *  1. La factura es de la EMPRESA: no tiene sucursal (respuesta del dueño a la pregunta 1, 25/11/2026, DEC-0902). Lo recibido sí es por sucursal.
 *  2. Cada gerente concilia lo de su sucursal (pregunta 6, DEC-0934): la propuesta, lo recibido que se muestra y las conciliaciones visibles se limitan al alcance de quien mira.
 *  3. «Anular conciliación» no pide motivo (la entrada de `anularConciliacion` no lo lleva) y solo se ofrece en una conciliación no anulada que repartió solo sucursales del alcance de quien anula.
 *  4. Sin filtros en la lista (pregunta 8, DEC-0905). Sin «tomar el costo» todavía: es el PR C.
 *  5. «Cargar factura» es el bloque de la factura de «Nueva compra» (los mismos datos y textos) con un producto por línea y sin remito, sin depósito y sin sucursal.
 */

type FuenteDeTexto = Readonly<{ decidio: string; donde: string }>;
type TextoDeFicha = Readonly<{ usos: readonly string[]; fuente: FuenteDeTexto }>;
type BotonDeFicha = Readonly<{
  id: string;
  texto: ClaveDeTexto;
  hace: Readonly<{ navega: string }> | Readonly<{ envia: ClaveAccion }>;
  /** Sin permiso el botón no se ofrece (denegar por defecto); el servidor vuelve a decidir al actuar. */
  sinPermiso: "APAGADO" | "AUSENTE";
}>;

export type FichaDeFacturas = Readonly<{
  archivos: readonly string[];
  rutas: readonly string[];
  /** La acción que exige la lectura de cada ruta. */
  accesos: Readonly<Record<string, ClaveAccion>>;
  botones: readonly BotonDeFicha[];
  /** El error y la falta de permiso salen con el mensaje genérico aprobado. */
  estados: Readonly<
    Record<
      | "FALTA_RECIBIR"
      | "FALTA_CONCILIAR"
      | "CONCILIADA_EN_PARTE"
      | "CONCILIADA"
      | "ANULADA"
      | "VACIA"
      | "SIN_PERMISO"
      | "ERROR",
      ClaveDeTexto
    >
  >;
  textos: Readonly<Partial<Record<ClaveDeTexto, TextoDeFicha>>>;
  estadoDeLaFicha: "EN_CONSTRUCCION" | "TERMINADA";
}>;

const DE_LA_MAQUETA: FuenteDeTexto = {
  decidio:
    "el dueño: textos del prototipo aprobado de compras (09/11/2026, compra.html), «Falta conciliar» y «Conciliada en parte» aprobados el 25/11/2026 y, para los nuevos, aceptación del orquestador por delegación de textos (DDD:173) con el chat del dueño del 25/11/2026 (DEC-0935)",
  donde:
    "Pedernal-docs 10-ux-ui, maquetas compra.html y compra-conciliar.html; 11-especificaciones/plan-de-pantallas-compras-4-2026-11-25.md §4 y §5; decisiones-del-dueno-2026-11.md filas 173 y 174",
};
const USO = "apps/web/ui/plantillas/compras/facturas/";

export const FICHA_DE_FACTURAS = {
  archivos: [
    "apps/web/app/s/app/(operacion)/compras/facturas/page.tsx",
    "apps/web/app/s/app/(operacion)/compras/facturas/nueva/page.tsx",
    "apps/web/app/s/app/(operacion)/compras/facturas/[id]/page.tsx",
    "apps/web/app/s/app/(operacion)/compras/facturas/[id]/conciliar/page.tsx",
    "apps/web/app/s/app/acciones-de-facturas.ts",
    "apps/web/servidor/facturas.ts",
    "apps/web/ui/plantillas/compras/rutas-de-compras.ts",
    "apps/web/ui/plantillas/compras/facturas/AccionesDeLaConciliacion.cliente.tsx",
    "apps/web/ui/plantillas/compras/facturas/PantallaDeCargarFactura.cliente.tsx",
    "apps/web/ui/plantillas/compras/facturas/PantallaDeConciliar.cliente.tsx",
    "apps/web/ui/plantillas/compras/facturas/PantallaDeDetalleDeFactura.tsx",
    "apps/web/ui/plantillas/compras/facturas/PantallaDeListaDeFacturas.tsx",
    "apps/web/ui/plantillas/compras/facturas/apoyo-de-facturas.ts",
    "apps/web/ui/plantillas/compras/facturas/modelo-de-cargar-factura.ts",
    "apps/web/ui/plantillas/compras/facturas/modelo-de-conciliar.ts",
    "apps/web/ui/plantillas/compras/facturas/modelo-de-facturas.ts",
    "apps/web/ui/plantillas/compras/facturas/resultado-de-factura.ts",
    "apps/web/ui/plantillas/compras/facturas/textos-de-facturas.ts",
    "src/composicion/entradas-de-facturas.ts",
    "src/composicion/facturas-web.ts",
  ],
  rutas: [
    "/compras/facturas",
    "/compras/facturas/nueva",
    "/compras/facturas/[id]",
    "/compras/facturas/[id]/conciliar",
  ],
  accesos: {
    "/compras/facturas": "comprobantes_de_proveedor.ver",
    "/compras/facturas/nueva": "comprobantes_de_proveedor.registrar",
    "/compras/facturas/[id]": "comprobantes_de_proveedor.ver",
    "/compras/facturas/[id]/conciliar": "conciliaciones.conciliar",
  },
  botones: [
    {
      id: "cargar-factura",
      texto: "compras.factura.cargar_factura",
      hace: { navega: "/compras/facturas/nueva" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "enviar-factura",
      texto: "compras.factura.cargar_factura",
      hace: { envia: "comprobantes_de_proveedor.registrar" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "conciliar",
      texto: "compras.conciliacion.conciliar",
      hace: { navega: "/compras/facturas/[id]/conciliar" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "confirmar-conciliacion",
      texto: "compras.conciliacion.validar_conciliacion",
      hace: { envia: "conciliaciones.conciliar" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "anular-conciliacion",
      texto: "compras.conciliacion.anular",
      hace: { envia: "conciliaciones.anular" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "anular-conciliacion-confirmar",
      texto: "ventas.ticket.anular",
      hace: { envia: "conciliaciones.anular" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "cancelar",
      texto: "catalogo.accion.cancelar",
      hace: { navega: "/compras/facturas/[id]" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "pagina-siguiente",
      texto: "fiscal.pantalla.listado_pagina_siguiente",
      hace: { navega: "/compras/facturas" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "volver-a-la-lista",
      texto: "compras.factura.titulo_lista",
      hace: { navega: "/compras/facturas" },
      sinPermiso: "APAGADO",
    },
  ],
  estados: {
    FALTA_RECIBIR: "compras.compra.facturada_falta_recibir",
    FALTA_CONCILIAR: "compras.conciliacion.estado_falta_conciliar",
    CONCILIADA_EN_PARTE: "compras.conciliacion.estado_conciliada_en_parte",
    CONCILIADA: "compras.conciliacion.todo_coincide",
    ANULADA: "compras.orden.anulada",
    VACIA: "catalogo.lista.sin_resultados",
    SIN_PERMISO: "compras.error.sin_permiso",
    ERROR: "compras.error.sin_permiso",
  },
  textos: {
    "compras.factura.titulo_lista": {
      usos: [
        `${USO}textos-de-facturas.ts`,
        "título de la lista, entrada del menú Compras y «volver» del detalle",
      ],
      fuente: DE_LA_MAQUETA,
    },
    "compras.factura.cargar_factura": {
      usos: ["enlace de la lista hacia «Cargar factura», título y botón del formulario"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.factura.total_segun_la_factura": {
      usos: ["total que dice la factura, en el detalle"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.compra.proveedor": {
      usos: ["buscador del proveedor del formulario"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.recepcion.recepcion": {
      usos: ["palabra antes del número de la recepción en cada línea a conciliar"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.conciliacion.conciliar": {
      usos: ["botón del detalle hacia la pantalla de repartir y título de esa pantalla"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.conciliacion.validar_conciliacion": {
      usos: ["botón que guarda el reparto, solo gerente y administrador"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.conciliacion.facturado": {
      usos: ["rótulo de lo facturado de cada línea, en el detalle y al conciliar"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.conciliacion.recibido": {
      usos: ["rótulo de lo recibido por sucursal, en el detalle y al conciliar"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.conciliacion.conciliado": {
      usos: ["rótulo de lo ya conciliado de cada línea, en el detalle"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.conciliacion.a_conciliar": {
      usos: ["rótulo del campo de cantidad por línea recibida al conciliar"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.conciliacion.conciliaciones": {
      usos: ["título del bloque con las conciliaciones hechas, solo con permiso para verlas"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.conciliacion.anular": {
      usos: ["botón de cada conciliación y título de su hoja, solo gerente y administrador"],
      fuente: DE_LA_MAQUETA,
    },
    "ventas.ticket.anular": { usos: ["botón de la hoja de anular"], fuente: DE_LA_MAQUETA },
    "catalogo.accion.cancelar": { usos: ["cierra la hoja de anular"], fuente: DE_LA_MAQUETA },
    "compras.compra.facturada_falta_recibir": {
      usos: ["estado de la factura sin nada recibido de sus productos"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.conciliacion.estado_falta_conciliar": {
      usos: ["estado de la factura con mercadería recibida sin repartir"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.conciliacion.estado_conciliada_en_parte": {
      usos: ["estado de la factura conciliada en parte"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.conciliacion.todo_coincide": {
      usos: ["estado de la factura conciliada por completo"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.orden.anulada": {
      usos: ["estado de la factura anulada y marca de una conciliación anulada"],
      fuente: DE_LA_MAQUETA,
    },
    "catalogo.lista.sin_resultados": { usos: ["lista vacía"], fuente: DE_LA_MAQUETA },
    "fiscal.pantalla.listado_pagina_siguiente": {
      usos: ["enlace al pie de la lista, solo si hay otra página"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.error.sin_permiso": {
      usos: ["cualquier error de las pantallas (el genérico, interfaz sobria)"],
      fuente: DE_LA_MAQUETA,
    },
  },
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDeFacturas;
