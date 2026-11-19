import { cantidadParaMostrar } from "../../../../../src/primitivas/cantidad/cantidad-para-mostrar";
import { horaParaMostrar } from "../../../../../src/primitivas/tiempo/instante-para-mostrar";
import { formatearImporte } from "../../patrones/formato-fiscal";
import { rotuloDelTicket } from "../cobrar/textos-de-cobrar";
import type { TextosDeTicketsDelDia } from "./textos-de-tickets-del-dia";

/**
 * El modelo de vista de «Tickets del día» y de la ficha del ticket (maqueta `tickets-del-dia.html`): cómo se escribe el estado, cada fila de la lista, cada renglón de la ficha. Puro: sin React ni servidor.
 * Lo que llega es lo que entrega el servidor (`tickets-del-dia-web.ts`): importes como texto decimal con moneda (nunca `number`), instantes ISO en UTC (acá se muestran en hora de Argentina).
 */

type Importe = Readonly<{ moneda: string; monto: string }>;

export type TicketDelDiaParaLaPantalla = Readonly<{
  ticketId: string;
  numero: number;
  numeroDeCorreccion: number;
  estado: string;
  totalOriginal: Importe;
  totalVigente: Importe;
  emitidoEn: string;
  facturado: boolean;
}>;

export type TicketsDelDiaParaLaPantalla = Readonly<{
  fechaNegocio: string;
  tickets: readonly TicketDelDiaParaLaPantalla[];
}>;

export type FichaDelTicketParaLaPantalla = Readonly<{
  ticketId: string;
  numero: number;
  numeroDeCorreccion: number;
  estado: string;
  fechaNegocio: string;
  ejemplarVigenteId: string;
  totalOriginal: Importe;
  totalVigente: Importe;
  emitidoPor: string | null;
  emitidoEn: string;
  facturado: boolean;
  renglones: readonly Readonly<{
    lineaCuentaId: string;
    descripcion: string;
    varianteNombre: string | null;
    opciones: readonly Readonly<{ grupo: string; nombre: string; recargo: string }>[];
    cantidad: string;
    unidadDeVenta: string;
    importe: string;
  }>[];
  caja: Readonly<{ id: string; nombre: string }> | null;
  cobros: readonly Readonly<{
    orden: number;
    medioTipo: string;
    cuentaDeCobro: Readonly<{ id: string; nombre: string }> | null;
    importe: Importe;
  }>[];
  anulacion: Readonly<{ motivo: string; hechaPor: string | null; hechaEn: string }> | null;
  imprimible: boolean;
}>;

export type EstadoEscrito =
  "COBRADO" | "COBRADO_Y_FACTURADO" | "ANULADO" | "CORTESIA" | "POR_COBRAR";

/**
 * Cómo se escribe el estado de un ticket. Lista de permitidos: cualquier otro valor LANZA (un estado nuevo no se dibuja como «Cobrado»; el servidor y la pantalla se enteran juntos).
 * `EMITIDO` es «Por cobrar» (solo salón); `COBRADO` es «Cobrado» y, con comprobante vigente, «Cobrado y facturado».
 */
export function estadoEscrito(t: Readonly<{ estado: string; facturado: boolean }>): EstadoEscrito {
  switch (t.estado) {
    case "ANULADO":
      return "ANULADO";
    case "CORTESIA":
      return "CORTESIA";
    case "EMITIDO":
      return "POR_COBRAR";
    case "COBRADO":
      return t.facturado ? "COBRADO_Y_FACTURADO" : "COBRADO";
    default:
      throw new RangeError(`estadoEscrito: estado desconocido «${t.estado}»`);
  }
}

export function textoDelEstado(estado: EstadoEscrito, textos: TextosDeTicketsDelDia): string {
  switch (estado) {
    case "ANULADO":
      return textos.anulado;
    case "CORTESIA":
      return textos.cortesia;
    case "POR_COBRAR":
      return textos.porCobrar;
    case "COBRADO_Y_FACTURADO":
      return textos.cobradoYFacturado;
    case "COBRADO":
      return textos.cobrado;
  }
}

/** El total que se muestra en la lista: el anulado, su total ORIGINAL (tachado, dice cuánto fue); el resto, el vigente. */
export const importeDeLaFila = (
  t: Pick<TicketDelDiaParaLaPantalla, "estado" | "totalOriginal" | "totalVigente">,
): Readonly<{ monto: string; tachado: boolean }> =>
  t.estado === "ANULADO"
    ? { monto: formatearImporte(t.totalOriginal.monto), tachado: true }
    : { monto: formatearImporte(t.totalVigente.monto), tachado: false };

/** «Ticket N.º 14, Cobrado, 21:14, $ 20.500,00»: el nombre accesible de la fila (maqueta, `aria-label`). */
export function nombreAccesibleDeLaFila(
  t: TicketDelDiaParaLaPantalla,
  textos: TextosDeTicketsDelDia,
): string {
  const estado = textoDelEstado(estadoEscrito(t), textos);
  return [
    rotuloDelTicket(t.numero),
    estado,
    horaParaMostrar(t.emitidoEn),
    importeDeLaFila(t).monto,
  ].join(", ");
}

/** Un renglón de la ficha: «2 Café», su importe y, aparte, la medida y las opciones elegidas. La cantidad sale con la misma regla de la venta y del papel (`cantidadParaMostrar`); una que no se puede mostrar lanza. */
export function lineaDeLaFicha(r: FichaDelTicketParaLaPantalla["renglones"][number]) {
  const cantidad = cantidadParaMostrar(r.cantidad, { unidadDeVenta: r.unidadDeVenta });
  if (!cantidad.ok) throw new RangeError("lineaDeLaFicha: cantidad no mostrable");
  return {
    clave: r.lineaCuentaId,
    titulo: `${cantidad.valor} ${r.descripcion}`,
    importe: formatearImporte(r.importe),
    detalle: [
      ...(r.varianteNombre === null ? [] : [r.varianteNombre]),
      ...r.opciones.map((o) => o.nombre),
    ].join(" · "),
  };
}
