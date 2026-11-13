import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import type { ClienteEscrito } from "./eleccion-de-emision";
import { formatearAlicuota, formatearCantidadConUnidad, formatearImporte } from "../../patrones/formato-fiscal";
import {
  clienteDeLaRevision,
  esDePruebas,
  etiquetaDelPunto,
  modoDelPunto,
  puntoDeVentaElegido,
  type PuntoParaEmitir,
  type VistaDeLaRevision,
} from "./modelo-de-emision";
import { nombreDeLaFila } from "./modelo-de-anulacion";

/**
 * Lo que se ve al emitir desde un ticket (E1 §3.6): el ticket cobrado tal como lo congeló ventas. Los renglones NO se editan ni se
 * calculan acá: descripción, cantidad con su unidad, precio, alícuota e importe vienen del ticket (los mismos que el servidor mandará a
 * facturar y que fiscal vuelve a comprobar contra el total cobrado). Puro, solo con cadenas. Previene: que la pantalla muestre un importe
 * calculado distinto del que se factura. Chequeo: `test/web/emitir-ticket-modelo.test.ts`.
 */

/** El ticket tal como lo entrega `facturar-tickets-web.ts` (`TicketParaEmitirParaLaPantalla`), sin importarlo: la pantalla no importa la composición. */
export type TicketParaLaPantalla = Readonly<{
  ticketId: string;
  numero: number;
  numeroDeCorreccion: number | null;
  sucursalId: string;
  total: Readonly<{ moneda: string; monto: string }>;
  lineas: readonly Readonly<{
    descripcion: string;
    varianteNombre: string | null;
    opciones: readonly string[];
    cantidad: string;
    unidad: string | null;
    precioUnitario: string;
    alicuota: string;
    importe: string;
  }>[];
}>;

/** «Producto · tamaño · opción · opción»: el mismo texto que se factura (separador « · » de `venta-rapida.html:421`). */
const SEPARADOR_DE_LA_DESCRIPCION = " · ";

/** «Venta N.º 124». */
export function tituloDelTicket(d: DiccionarioResuelto, t: TicketParaLaPantalla): string {
  return texto(d, "fiscal.pantalla.emitir_venta_numero", { numero: String(t.numero) });
}

export function vistaDeLaRevisionDeUnTicket(
  d: DiccionarioResuelto,
  datos: Readonly<{
    ticket: TicketParaLaPantalla;
    cliente: ClienteEscrito;
    discriminaIva: boolean;
    puntos: readonly PuntoParaEmitir[];
    puntoElegido: string;
  }>,
): VistaDeLaRevision {
  const { ticket, discriminaIva, puntos } = datos;
  const elegido = puntoDeVentaElegido(puntos, datos.puntoElegido);
  const unico = puntos.length === 1 && elegido !== null ? etiquetaDelPunto(d, elegido) : "";
  return {
    titulo: texto(d, "fiscal.pantalla.emitir_revisa_y_emiti"),
    cliente: clienteDeLaRevision(d, datos.cliente),
    renglones: {
      rotulo: texto(d, "fiscal.pantalla.rotulo_renglones"),
      filas: ticket.lineas.map((l, i) => {
        const tasa = formatearAlicuota(l.alicuota);
        return {
          id: i,
          descripcion: [
            l.descripcion,
            ...(l.varianteNombre === null ? [] : [l.varianteNombre]),
            ...l.opciones,
          ].join(SEPARADOR_DE_LA_DESCRIPCION),
          cuenta: texto(d, "fiscal.pantalla.renglon_cuenta", {
            cantidad: formatearCantidadConUnidad(l.cantidad, l.unidad),
            precio: formatearImporte(l.precioUnitario),
          }),
          iva: discriminaIva ? nombreDeLaFila(d, l.alicuota, tasa) : null,
          importe: formatearImporte(l.importe),
        };
      }),
      rotuloDelTotal: texto(d, "fiscal.pantalla.rotulo_total"),
      total: formatearImporte(ticket.total.monto),
    },
    puntoDeVenta: {
      rotulo: texto(d, "fiscal.pantalla.rotulo_punto_de_venta"),
      modo: modoDelPunto(puntos),
      texto: puntos.length === 0 ? texto(d, "fiscal.pantalla.config_cartel_ninguno_activo") : unico,
      opciones: puntos.map((p) => ({ valor: p.id, etiqueta: etiquetaDelPunto(d, p) })),
      avisoDePruebas:
        elegido !== null && esDePruebas(elegido)
          ? texto(d, "fiscal.pantalla.config_pv_aviso_pruebas")
          : null,
    },
  };
}
