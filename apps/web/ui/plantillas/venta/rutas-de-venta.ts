/** La dirección de la venta rápida del mostrador (módulo y pantalla, como `/caja/medios-de-pago`). */
export const RUTA_DE_LA_VENTA = "/ventas/venta-rapida";

/** La lista de los tickets de la jornada (módulo y pantalla, como la venta rápida). */
export const RUTA_DE_TICKETS_DEL_DIA = "/ventas/tickets-del-dia";

/** La ficha de un ticket. El id va codificado: nunca arma una ruta con lo que no es un id. */
export const rutaDeLaFichaDelTicket = (ticketId: string): string =>
  `${RUTA_DE_TICKETS_DEL_DIA}/${encodeURIComponent(ticketId)}`;
