import type { ClaveAccion } from "../modulos/catalogo";
import type { ClaveDeTexto } from "../vocabulario/catalogo";

/**
 * LAS FICHAS DE «TICKETS DEL DÍA» Y «FICHA DEL TICKET» (DDD:174: toda pantalla nueva nace con ficha). Dos rutas: la lista de la jornada (`/ventas/tickets-del-dia`) y la ficha de un ticket
 * (`/ventas/tickets-del-dia/[ticketId]`) con «Imprimir ticket» y «Anular»; «Ticket del cliente» y la hoja de anular son los de la venta rápida (`ficha-de-cobrar.ts`). Es solo una declaración: la comprueba
 * `test/web/ficha-de-tickets-del-dia.test.ts` contra el catálogo de textos y el de permisos. No crea acciones ni permisos.
 * Previene: un botón o un texto que nadie aprobó, y una acción de permiso que se mueve sin que la ficha lo note.
 *
 * DIFERENCIAS CON LA MAQUETA (`tickets-del-dia.html`; la maqueta manda: cada desvío lleva su fundamento y lo decide el dueño):
 *  1. La fila de la lista es un ENLACE a la ficha, no un botón: la ficha tiene su ruta y lo que navega es un enlace (teclado, lector de pantalla, abrir en otra pestaña); se ve y se toca igual. El dueño lo aceptó el 18/11/2026 (T5).
 *  2. La ruta lleva el módulo (`/ventas/tickets-del-dia`), como la venta rápida (`/ventas/venta-rapida`): es la convención de rutas de la app (DEC-0783).
 *  3. «Caja 1» de la maqueta es el nombre real de la caja, sin rótulo (no hay texto aprobado «Caja» en la ficha): SUPUESTO de DEC-0782, un texto más si el dueño lo quiere.
 *  4. Orden de los botones de la hoja de anular: «Cancelar» y después «Anular» (el dueño, 18/11/2026; rige en todas las hojas de anular).
 *  5. El correo ausente no dibuja la línea (la maqueta siempre lo tiene; sin texto nuevo).
 */

type FuenteDeTexto = Readonly<{ decidio: string; donde: string }>;
type TextoDeFicha = Readonly<{ usos: readonly string[]; fuente: FuenteDeTexto }>;
type BotonDeFicha = Readonly<{
  id: string;
  texto: ClaveDeTexto;
  hace:
    | Readonly<{ navega: string }>
    | Readonly<{ envia: ClaveAccion }>
    | "abre-el-ticket"
    | "abre-el-cuadro"
    | "vuelve";
  /** La pantalla no esconde ni apaga por permiso, factura ni día cerrado (Interfaz sobria): decide el servidor y su respuesta se muestra. */
  sinPermiso: "APAGADO" | "AUSENTE";
}>;

export type FichaDeTicketsDelDia = Readonly<{
  archivos: readonly string[];
  rutas: readonly string[];
  botones: readonly BotonDeFicha[];
  /** Todo rechazo de negocio sale como el genérico; la única excepción es anular con factura vigente. */
  estados: Readonly<
    Record<"VACIO" | "SIN_PERMISO" | "ANULAR_RECHAZADO" | "ANULAR_CON_FACTURA", ClaveDeTexto>
  >;
  textos: Readonly<Partial<Record<ClaveDeTexto, TextoDeFicha>>>;
  estadoDeLaFicha: "EN_CONSTRUCCION" | "TERMINADA";
}>;

const DEL_DUENO: FuenteDeTexto = {
  decidio:
    "el dueño, 18/11/2026 (aprobó la maqueta y sus ocho respuestas, fila 293), con la regla «manda la maqueta» (fila 294); decisiones-del-dueno-2026-11.md; por delegación (fila 173) el orquestador aceptó los textos nuevos",
  donde:
    "Pedernal-docs 10-ux-ui, maqueta tickets-del-dia.html (vLista, vFicha, vDlg); DEC-0782 y DEC-0783",
};
const USO = "apps/web/ui/plantillas/tickets-del-dia/";

export const FICHA_DE_TICKETS_DEL_DIA = {
  archivos: [
    "apps/web/app/s/app/(operacion)/ventas/tickets-del-dia/page.tsx",
    "apps/web/app/s/app/(operacion)/ventas/tickets-del-dia/[ticketId]/page.tsx",
    "apps/web/app/s/app/acciones-de-cobrar.ts",
    "apps/web/servidor/tickets-del-dia.ts",
    "apps/web/ui/plantillas/tickets-del-dia/ListaDeTickets.tsx",
    "apps/web/ui/plantillas/tickets-del-dia/FichaDelTicket.cliente.tsx",
    "apps/web/ui/plantillas/tickets-del-dia/modelo-de-tickets-del-dia.ts",
    "apps/web/ui/plantillas/tickets-del-dia/textos-de-tickets-del-dia.ts",
    "apps/web/ui/plantillas/cobrar/AnularElTicket.cliente.tsx",
    "apps/web/ui/plantillas/cobrar/TicketDelCliente.cliente.tsx",
  ],
  rutas: ["/ventas/tickets-del-dia", "/ventas/tickets-del-dia/[ticketId]"],
  botones: [
    {
      id: "volver-a-la-lista",
      texto: "ventas.ticket.volver",
      hace: { navega: "/ventas/tickets-del-dia" },
      sinPermiso: "APAGADO",
    },
    {
      id: "imprimir-ticket",
      texto: "ventas.ticket.imprimir_ticket",
      hace: "abre-el-ticket",
      sinPermiso: "APAGADO",
    },
    { id: "anular", texto: "ventas.ticket.anular", hace: "abre-el-cuadro", sinPermiso: "APAGADO" },
    { id: "cancelar", texto: "ventas.venta.cancelar", hace: "vuelve", sinPermiso: "APAGADO" },
    {
      id: "anular-ok",
      texto: "ventas.ticket.anular",
      hace: { envia: "tickets.corregir" },
      sinPermiso: "APAGADO",
    },
  ],
  estados: {
    VACIO: "ventas.tickets.vacio",
    SIN_PERMISO: "ventas.error.accion_no_permitida",
    ANULAR_RECHAZADO: "ventas.error.accion_no_permitida",
    ANULAR_CON_FACTURA: "ventas.error.ticket_con_factura_vigente",
  },
  textos: {
    "ventas.tickets.titulo": {
      usos: [`${USO}textos-de-tickets-del-dia.ts`, "título de la lista y de la ficha"],
      fuente: DEL_DUENO,
    },
    "ventas.tickets.menu": {
      usos: ["entrada de menú de Ventas, debajo de «Venta rápida»"],
      fuente: DEL_DUENO,
    },
    "ventas.tickets.vacio": { usos: ["lista de la jornada sin tickets"], fuente: DEL_DUENO },
    "ventas.tickets.jornada": {
      usos: ["cabecera de la lista y de la ficha (fecha de negocio)"],
      fuente: DEL_DUENO,
    },
    "ventas.ticket.estado.cortesia": { usos: ["estado en la lista y la ficha"], fuente: DEL_DUENO },
    "ventas.ticket.estado.por_cobrar": {
      usos: ["estado en la lista y la ficha"],
      fuente: DEL_DUENO,
    },
    "ventas.ticket.estado.cobrado_y_facturado": {
      usos: ["estado de un ticket con comprobante vigente"],
      fuente: DEL_DUENO,
    },
    "ventas.ticket.cobros": { usos: ["encabezado de los cobros de la ficha"], fuente: DEL_DUENO },
    "ventas.cobro.cobrado": { usos: ["estado en la lista y la ficha"], fuente: DEL_DUENO },
    "ventas.ticket.anulado": { usos: ["estado y franja de la ficha anulada"], fuente: DEL_DUENO },
    "ventas.venta.total": { usos: ["total de la ficha"], fuente: DEL_DUENO },
    "ventas.ticket.volver": { usos: ["«‹» de la ficha"], fuente: DEL_DUENO },
    "ventas.ticket.imprimir_ticket": {
      usos: ["botón del pie de la ficha, solo si se puede imprimir"],
      fuente: DEL_DUENO,
    },
    "ventas.ticket.anular": { usos: ["botón del pie de la ficha"], fuente: DEL_DUENO },
    "ventas.venta.cancelar": {
      usos: ["botón de la hoja de anular, antes de «Anular»"],
      fuente: DEL_DUENO,
    },
    "ventas.error.accion_no_permitida": {
      usos: ["aviso de la ficha releída tras un rechazo y errores de la hoja"],
      fuente: DEL_DUENO,
    },
    "ventas.error.ticket_con_factura_vigente": {
      usos: ["rechazo de anular dentro de la hoja"],
      fuente: DEL_DUENO,
    },
  },
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDeTicketsDelDia;
