import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { fechaParaMostrar } from "../../../../../src/primitivas/tiempo/fecha-para-mostrar";
import { fechaCivilDesdeTexto } from "../../../../../src/primitivas/tiempo/fecha-civil";

/**
 * Los textos de «Tickets del día» y de la ficha del ticket ya resueltos (`ventas.tickets.*` y `ventas.ticket.*`, cada uno con su fuente en `catalogo-ventas.ts`). Acá no se arma ningún texto
 * nuevo: se eligen los aprobados. La jornada se escribe DD/MM/AAAA (`fechaParaMostrar`, fila 178) a partir de la fecha de negocio, nunca del instante.
 */
export type TextosDeTicketsDelDia = Readonly<{
  titulo: string;
  vacio: string;
  cobrado: string;
  cobradoYFacturado: string;
  anulado: string;
  cortesia: string;
  porCobrar: string;
  total: string;
  cobros: string;
  volver: string;
  imprimirTicket: string;
  anular: string;
  noPermitido: string;
}>;

export function textosDeTicketsDelDia(): TextosDeTicketsDelDia {
  return {
    titulo: texto({}, "ventas.tickets.titulo"),
    vacio: texto({}, "ventas.tickets.vacio"),
    cobrado: texto({}, "ventas.cobro.cobrado"),
    cobradoYFacturado: texto({}, "ventas.ticket.estado.cobrado_y_facturado"),
    anulado: texto({}, "ventas.ticket.anulado"),
    cortesia: texto({}, "ventas.ticket.estado.cortesia"),
    porCobrar: texto({}, "ventas.ticket.estado.por_cobrar"),
    total: texto({}, "ventas.venta.total"),
    cobros: texto({}, "ventas.ticket.cobros"),
    volver: texto({}, "ventas.ticket.volver"),
    imprimirTicket: texto({}, "ventas.ticket.imprimir_ticket"),
    anular: texto({}, "ventas.ticket.anular"),
    noPermitido: texto({}, "ventas.error.accion_no_permitida"),
  };
}

/** «Jornada 17/11/2026» a partir de la fecha de negocio (AAAA-MM-DD). Una fecha que no lo es lanza: nunca se muestra cruda. */
export function jornadaParaMostrar(fechaNegocio: string): string {
  const fecha = fechaCivilDesdeTexto(fechaNegocio);
  if (!fecha.ok) throw new RangeError("jornada: no es una fecha civil");
  return texto({}, "ventas.tickets.jornada", { fecha: fechaParaMostrar(fecha.valor) });
}
