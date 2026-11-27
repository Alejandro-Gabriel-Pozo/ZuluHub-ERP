import type { ClaveDeTexto } from "../vocabulario/catalogo";

/**
 * Los textos de «Cobrar un ticket a cuenta» (CC-5 B2b) en la ficha de las pantallas de la cuenta corriente: aparte de `ficha-de-cuenta-corriente.ts` por el tope de tamaño de archivo. Cada uno con su
 * uso y su fuente (`DEC-CCL-009`); `test/web/ficha-de-cuenta-corriente.test.ts` los compara con el catálogo de textos.
 */
export type FuenteDeTexto = Readonly<{ decidio: string; donde: string }>;
export type TextoDeFicha = Readonly<{ usos: readonly string[]; fuente: FuenteDeTexto }>;

const B2B: FuenteDeTexto = {
  decidio:
    "el dueño, 26/11/2026 (chat: «Apruebo» a los textos de la maqueta P4; la corrección de «sin caja abierta»: la caja abierta es obligatoria para todo medio); el orquestador asentó los quince textos en DEC-CCL-009 por la delegación de la fila 173",
  donde:
    "Pedernal-docs 11-especificaciones/briefs/maquetas/cuenta-corriente-ficha-listado-y-cobro.html (P4, «Cobrar un ticket a cuenta»); arquitectura/decisiones/registro/DEC-CCL-009.json",
};
const COBRAR = "modelo-de-cobrar-a-cuenta.ts";

export const TEXTOS_DE_LA_FICHA_DE_COBRAR_A_CUENTA = {
  "cuenta_corriente.cobro.titulo": {
    usos: ["título de la pantalla y de la pestaña de cobrar un ticket a cuenta"],
    fuente: B2B,
  },
  "cuenta_corriente.cobro.nota": {
    usos: ["nota de la hoja: el cobro es por el total del ticket"],
    fuente: B2B,
  },
  "cuenta_corriente.cobro.ticket_valor": {
    usos: [COBRAR + " (valor del ticket: número, canal y fecha)"],
    fuente: B2B,
  },
  "cuenta_corriente.cobro.vencia_el": {
    usos: ["rótulo del vencimiento del cargo en la hoja"],
    fuente: B2B,
  },
  "cuenta_corriente.cobro.total_a_cobrar": {
    usos: ["rótulo del total del ticket en la hoja"],
    fuente: B2B,
  },
  "cuenta_corriente.cobro.medio": {
    usos: ["rótulo del selector de medio de cobro"],
    fuente: B2B,
  },
  "cuenta_corriente.cobro.caja": { usos: ["rótulo del selector de caja"], fuente: B2B },
  "cuenta_corriente.cobro.caja_opcion": {
    usos: [COBRAR + " (opción de caja: caja, sucursal y sesión abierta hoy)"],
    fuente: B2B,
  },
  "cuenta_corriente.cobro.entra_en_la_caja": {
    usos: [COBRAR + " (fecha de la caja elegida)"],
    fuente: B2B,
  },
  "cuenta_corriente.cobro.cobrar": {
    usos: ["botón «Cobrar» con el importe del ticket"],
    fuente: B2B,
  },
  "cuenta_corriente.cobro.cobrado_detalle": {
    usos: [COBRAR + " (estado «Cobrado»: ticket, fecha, medio, importe y saldo del cliente)"],
    fuente: B2B,
  },
  "cuenta_corriente.cobro.sin_caja": {
    usos: ["aviso cuando no hay caja abierta hoy; «Cobrar» queda apagado"],
    fuente: B2B,
  },
  "cuenta_corriente.cobro.ver_cuenta": {
    usos: ["enlace del estado «Cobrado» que vuelve a la ficha"],
    fuente: B2B,
  },
  "cuenta_corriente.cobro.cobrar_otro": {
    usos: ["enlace del estado «Cobrado» que abre el siguiente cargo pendiente"],
    fuente: B2B,
  },
  "cuenta_corriente.cobro.boton_de_la_ficha": {
    usos: ["botón de la ficha del cliente que abre la hoja de cobro"],
    fuente: B2B,
  },
} as const satisfies Readonly<Partial<Record<ClaveDeTexto, TextoDeFicha>>>;
