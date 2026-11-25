import type { ClaveAccion } from "../modulos/catalogo";
import type { ClaveDeTexto } from "../vocabulario/catalogo";

/**
 * LA FICHA DE LAS PANTALLAS «RECEPCIONES» (DDD:174: toda pantalla nueva nace con ficha; Compras 4, recepción separada, PR A). Tres rutas: la lista de recepciones de la sucursal (`/compras/recepciones`), «Recibir»
 * (`/compras/recepciones/recibir`) y el detalle de una recepción con «Confirmar recepción» y «Anular recepción» (`/compras/recepciones/[id]`). La comprueba `test/web/ficha-de-recepciones.test.ts` contra el catálogo
 * de textos, el de permisos y la tabla del menú. No crea acciones ni permisos. Previene: un botón o un texto que nadie aprobó, y una ruta o una fila de menú que se mueve sin que la ficha lo note.
 *
 * DIFERENCIAS CON LA MAQUETA (`compra-recibir.html`; la maqueta manda: cada desvío lleva su fundamento y lo decide el dueño, DDD:294):
 *  1. «Recibir» NO pide precio (decisión del dueño, 25/11/2026, pregunta 2, opción «b chica», DEC-0903): lo recibido queda sin costo hasta tomar el costo de la factura. Es el formulario de «Nueva compra» en su modo
 *     «recepción»: sin factura, sin cotización de lo que entra al stock, sin depósito (se elige al confirmar) y con el botón «Recibir».
 *  2. Sin control de la mercadería ni destino por línea, y sin filtros en la lista (DEC-0905).
 *  3. Sin el aviso «El stock entra cuando se confirma la recepción» de la maqueta (Interfaz sobria: lo rechazó el orquestador el 25/11/2026).
 *  4. El detalle muestra cada línea con lo recibido en la unidad en que se compró («2 kg»); no muestra «Entra a tu stock» ni importes.
 *  5. La sucursal no es un campo: la pone el servidor (la elegida en este dispositivo). Una recepción de otra sucursal sale como una que no existe.
 *  6. «Corregir lo recibido» (PR D, decisión del dueño del 25/11/2026, DEC-0937): en el detalle de una recepción CONFIRMADA, un botón por línea para gerente y administrador abre una hoja con la cantidad
 *     que de verdad llegó, el motivo (lista cerrada: error de carga, reparto interno, faltante del proveedor) y una nota opcional; abajo, «Correcciones» con la historia. SUPUESTO (DEC-0939): el botón vive en el detalle
 *     de la RECEPCIÓN (la maqueta lo muestra en el detalle de la factura, donde lo recibido se ve por sucursal sumado): acá hay una línea por recepción y el servidor necesita saber cuál. Mover el botón es solo de pantalla.
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

export type FichaDeRecepciones = Readonly<{
  archivos: readonly string[];
  rutas: readonly string[];
  /** La acción que exige la lectura de cada ruta. */
  accesos: Readonly<Record<string, ClaveAccion>>;
  botones: readonly BotonDeFicha[];
  /** El error y la falta de permiso salen con el mensaje genérico aprobado. */
  estados: Readonly<
    Record<
      | "LISTA_CON_RECEPCIONES"
      | "VACIA"
      | "POR_CONFIRMAR"
      | "CONFIRMADA"
      | "ANULADA"
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
    "el dueño: textos del prototipo aprobado de compras (09/11/2026, compra.html) y, para los nuevos, aceptación del orquestador por delegación de textos (DDD:173) con el chat del dueño del 25/11/2026 (DEC-0906)",
  donde:
    "Pedernal-docs 10-ux-ui, maquetas compra.html y compra-recibir.html; 11-especificaciones/plan-de-pantallas-compras-4-2026-11-25.md §4 y §5; decisiones-del-dueno-2026-11.md filas 173 y 174",
};
const USO = "apps/web/ui/plantillas/compras/recepciones/";

export const FICHA_DE_RECEPCIONES = {
  archivos: [
    "apps/web/app/s/app/(operacion)/compras/recepciones/page.tsx",
    "apps/web/app/s/app/(operacion)/compras/recepciones/recibir/page.tsx",
    "apps/web/app/s/app/(operacion)/compras/recepciones/[id]/page.tsx",
    "apps/web/app/s/app/acciones-de-recepciones.ts",
    "apps/web/servidor/recepciones.ts",
    "apps/web/ui/plantillas/compras/rutas-de-compras.ts",
    "apps/web/ui/plantillas/compras/nueva/PantallaDeNuevaCompra.cliente.tsx",
    "apps/web/ui/plantillas/compras/recepciones/AccionesDeLaRecepcion.cliente.tsx",
    "apps/web/ui/plantillas/compras/recepciones/CorregirLoRecibido.cliente.tsx",
    "apps/web/ui/plantillas/compras/recepciones/PantallaDeDetalleDeRecepcion.tsx",
    "apps/web/ui/plantillas/compras/recepciones/PantallaDeListaDeRecepciones.tsx",
    "apps/web/ui/plantillas/compras/recepciones/modelo-de-recepciones.ts",
    "apps/web/ui/plantillas/compras/recepciones/resultado-de-recepcion.ts",
    "apps/web/ui/plantillas/compras/recepciones/textos-de-recepciones.ts",
    "src/composicion/entradas-de-recepciones.ts",
    "src/composicion/recepciones-web.ts",
  ],
  rutas: ["/compras/recepciones", "/compras/recepciones/recibir", "/compras/recepciones/[id]"],
  accesos: {
    "/compras/recepciones": "recepciones.ver",
    "/compras/recepciones/recibir": "recepciones.registrar",
    "/compras/recepciones/[id]": "recepciones.ver",
  },
  botones: [
    {
      id: "recibir",
      texto: "compras.recepcion.recibir",
      hace: { navega: "/compras/recepciones/recibir" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "enviar-recepcion",
      texto: "compras.recepcion.recibir",
      hace: { envia: "recepciones.registrar" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "confirmar-recepcion",
      texto: "compras.recepcion.validar_recepcion",
      hace: { envia: "recepciones.confirmar" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "anular-recepcion",
      texto: "compras.recepcion.anular_recepcion",
      hace: { envia: "recepciones.anular" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "anular-recepcion-confirmar",
      texto: "ventas.ticket.anular",
      hace: { envia: "recepciones.anular" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "corregir-lo-recibido",
      texto: "compras.recepcion.corregir_recibido",
      hace: { envia: "compras.corregir" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "corregir-lo-recibido-enviar",
      texto: "compras.correccion.corregir",
      hace: { envia: "compras.corregir" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "cancelar",
      texto: "catalogo.accion.cancelar",
      hace: { navega: "/compras/recepciones/[id]" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "pagina-siguiente",
      texto: "fiscal.pantalla.listado_pagina_siguiente",
      hace: { navega: "/compras/recepciones" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "volver-a-la-lista",
      texto: "compras.recepcion.titulo_lista",
      hace: { navega: "/compras/recepciones" },
      sinPermiso: "APAGADO",
    },
  ],
  estados: {
    LISTA_CON_RECEPCIONES: "compras.recepcion.estado_por_validar",
    VACIA: "catalogo.lista.sin_resultados",
    POR_CONFIRMAR: "compras.recepcion.estado_por_validar",
    CONFIRMADA: "compras.compra.recibida_sin_facturar",
    ANULADA: "compras.orden.anulada",
    SIN_PERMISO: "compras.error.sin_permiso",
    ERROR: "compras.error.sin_permiso",
  },
  textos: {
    "compras.recepcion.titulo_lista": {
      usos: [
        `${USO}textos-de-recepciones.ts`,
        "título de la lista, entrada del menú Compras y «volver» del detalle",
      ],
      fuente: DE_LA_MAQUETA,
    },
    "compras.recepcion.recepcion": {
      usos: [
        `${USO}textos-de-recepciones.ts`,
        "palabra antes del número en la fila y en el título del detalle",
      ],
      fuente: DE_LA_MAQUETA,
    },
    "compras.recepcion.recibir": {
      usos: ["enlace de la lista hacia «Recibir», título y botón del formulario"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.recepcion.validar_recepcion": {
      usos: ["botón del detalle de una recepción «Por confirmar», solo gerente y administrador"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.recepcion.anular_recepcion": {
      usos: ["botón y título de la hoja para anular una recepción «Por confirmar»"],
      fuente: DE_LA_MAQUETA,
    },
    "ventas.ticket.anular": { usos: ["botón de la hoja de anular"], fuente: DE_LA_MAQUETA },
    "ventas.ticket.motivo": {
      usos: ["motivo de la hoja de anular y de la recepción anulada"],
      fuente: DE_LA_MAQUETA,
    },
    "catalogo.accion.cancelar": { usos: ["cierra la hoja de anular"], fuente: DE_LA_MAQUETA },
    "compras.recepcion.estado_por_validar": {
      usos: ["estado de la recepción pendiente en la fila y en el detalle"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.compra.recibida_sin_facturar": {
      usos: ["estado de la recepción confirmada y sin conciliar"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.recepcion.estado_facturada_en_parte": {
      usos: ["estado de la recepción conciliada en parte"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.recepcion.estado_facturada": {
      usos: ["estado de la recepción conciliada por completo"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.orden.anulada": { usos: ["estado de la recepción anulada"], fuente: DE_LA_MAQUETA },
    "compras.recepcion.remito_del_proveedor": {
      usos: ["remito del detalle"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.recepcion.sin_remito": { usos: ["detalle sin remito"], fuente: DE_LA_MAQUETA },
    "compras.compra.deposito": {
      usos: ["selector del depósito al confirmar, solo si hay más de uno"],
      fuente: DE_LA_MAQUETA,
    },
    "catalogo.lista.sin_resultados": { usos: ["lista vacía"], fuente: DE_LA_MAQUETA },
    "fiscal.pantalla.listado_pagina_siguiente": {
      usos: ["enlace al pie de la lista, solo si hay otra página"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.recepcion.corregir_recibido": {
      usos: [
        "botón de cada línea de una recepción confirmada y título de la hoja, solo gerente y administrador",
      ],
      fuente: DE_LA_MAQUETA,
    },
    "compras.correccion.corregir": {
      usos: ["botón que envía la corrección de lo recibido"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.recepcion.cantidad_recibida": {
      usos: ["campo de la cantidad que de verdad llegó, en la hoja de corregir"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.recepcion.motivo_correccion": {
      usos: ["selector del motivo de la corrección (lista cerrada)"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.recepcion.causa_error_de_carga": {
      usos: ["opción del motivo y de la historia de correcciones"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.recepcion.causa_reparto_interno": {
      usos: ["opción del motivo y de la historia de correcciones"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.recepcion.causa_faltante": {
      usos: ["opción del motivo y de la historia de correcciones"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.recepcion.aviso_reparto_interno": {
      usos: ["aviso de la hoja cuando el motivo es «Reparto interno»"],
      fuente: DE_LA_MAQUETA,
    },
    "clientes.formulario.nota": {
      usos: ["nota opcional de la corrección de lo recibido"],
      fuente: DE_LA_MAQUETA,
    },
    "cierre.control.correcciones": {
      usos: ["título de la historia de correcciones del detalle de la recepción"],
      fuente: DE_LA_MAQUETA,
    },
    "conexion.enviando": { usos: ["botón de la hoja mientras envía"], fuente: DE_LA_MAQUETA },
    "estado.reintentar": {
      usos: ["reintento de la corrección tras un corte (misma clave, mismo pedido)"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.error.sin_permiso": {
      usos: ["cualquier error de las pantallas (el genérico, interfaz sobria)"],
      fuente: DE_LA_MAQUETA,
    },
  },
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDeRecepciones;
