import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import { direccionDeEmitirDesdeUnTicket, direccionDePendientes } from "./filtros-del-listado";
import { formatearFecha, formatearImporte } from "../../patrones/formato-fiscal";

/**
 * El modelo de vista de «Pendientes de facturar» (E1 §3.6): los tickets cobrados sin comprobante vigente, de la sucursal con la que
 * trabaja la persona. De lo que entrega `facturar-tickets-web.ts` solo se ve lo que sigue: el número de la venta, el día y el total. Es
 * una lista blanca a propósito: el motivo (nunca facturado o anulado), la sucursal, la cuenta y la mesa de origen no están en el modelo, así
 * que no pueden aparecer (decisión 175: sin texto propio para distinguirlos). Tocar una fila abre Emitir desde ese ticket. Chequeo:
 * `test/web/pendientes-modelo.test.ts`.
 */

/** Lo que la lista necesita de `PendientesDeFacturarParaLaPantalla`: un subconjunto estructural (la UI no importa la composición). */
export type PendientesParaMostrar = Readonly<{
  tickets: readonly Readonly<{
    ticketId: string;
    numero: number;
    fechaNegocio: string;
    total: Readonly<{ moneda: string; monto: string }>;
  }>[];
  siguiente: Readonly<{ fechaNegocio: string; numero: number; sucursalId: string }> | null;
}>;

type FilaDePendiente = Readonly<{
  id: string;
  /** El enlace a Emitir desde ese ticket. */
  href: string;
  /** «Venta N.º 124». */
  venta: string;
  /** «14/10/2026». */
  fecha: string;
  /** «$ 12.000,00». */
  total: string;
}>;

export type PendientesArmados = Readonly<{
  filas: readonly FilaDePendiente[];
  /** El aviso de la lista vacía, o `null` si hay tickets. */
  vacio: string | null;
  siguiente: Readonly<{ href: string; texto: string }> | null;
}>;

/** La dirección de la página que sigue: los tres datos del cursor viajan como parámetros y el servidor los valida de nuevo. */
export function direccionDeLaPaginaDePendientes(
  cursor: NonNullable<PendientesParaMostrar["siguiente"]>,
): string {
  const parametros = new URLSearchParams({
    despuesFecha: cursor.fechaNegocio,
    despuesNumero: String(cursor.numero),
    despuesSucursal: cursor.sucursalId,
  });
  return `${direccionDePendientes()}?${parametros.toString()}`;
}

export function armarLosPendientes(
  d: DiccionarioResuelto,
  pagina: PendientesParaMostrar,
): PendientesArmados {
  return {
    filas: pagina.tickets.map((t) => ({
      id: t.ticketId,
      href: direccionDeEmitirDesdeUnTicket(t.ticketId),
      venta: texto(d, "fiscal.pantalla.emitir_venta_numero", { numero: String(t.numero) }),
      fecha: formatearFecha(t.fechaNegocio),
      total: formatearImporte(t.total.monto),
    })),
    vacio: pagina.tickets.length === 0 ? texto(d, "fiscal.pantalla.pendientes_vacio") : null,
    siguiente:
      pagina.siguiente === null
        ? null
        : {
            href: direccionDeLaPaginaDePendientes(pagina.siguiente),
            texto: texto(d, "fiscal.pantalla.listado_pagina_siguiente"),
          },
  };
}

/** La entrada de la consulta desde la dirección: solo la página que sigue (lo demás lo pone el servidor). Lo inválido se ignora y vuelve a la primera. */
export function pedidoDeLosPendientes(
  params: Readonly<Record<string, string | readonly string[] | undefined>>,
): unknown {
  const uno = (nombre: string): string | undefined => {
    const valor = params[nombre];
    return Array.isArray(valor) ? (valor[0] as string | undefined) : (valor as string | undefined);
  };
  const fechaNegocio = uno("despuesFecha");
  const numero = uno("despuesNumero");
  const sucursalId = uno("despuesSucursal");
  return fechaNegocio === undefined || numero === undefined || sucursalId === undefined
    ? {}
    : { despuesDe: { fechaNegocio, numero, sucursalId } };
}
