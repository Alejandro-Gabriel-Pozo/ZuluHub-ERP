import { formatearFecha, formatearImporte } from "../../patrones/formato-fiscal";
import {
  datosParaEnviar,
  estadoDelCobro,
  medioInicial,
  nombreDelMedio,
  pagoNuevo,
  type MedioParaCobrar,
  type OpcionesParaCobrar,
  type PagoEnEdicion,
} from "../cobrar/modelo-de-cobro";
import { SIN_DATO } from "./modelo-de-cuenta-corriente";
import {
  cobrarImporte,
  detalleDelCobrado,
  entraEnLaCaja,
  opcionDeCaja,
  valorDelTicket,
  type TextosDeCobrarACuenta,
} from "./textos-de-cobrar-a-cuenta";

/**
 * El modelo de vista de «Cobrar un ticket a cuenta» (CC-5 B2b; maqueta P4 `cuenta-corriente-ficha-listado-y-cobro.html`): qué se muestra del ticket, qué cajas se ofrecen, si se puede cobrar, qué pedido
 * sale y cómo se cuenta lo cobrado. Puro: sin React ni servidor. Lo que llega es lo que entrega el servidor (`cobrar-a-cuenta-web.ts`): importes como texto decimal exacto, fechas `AAAA-MM-DD`.
 * El importe a cobrar es el del ticket y se MUESTRA, pero NO viaja: el servidor pone el total del ejemplar vigente (no se puede cobrar de más ni de menos). Lo que esta pantalla ofrece o apaga es una
 * ayuda: el servidor vuelve a decidir permisos, caja, jornada, datos y total, y su respuesta es la que manda. Un dato ausente es «—», nunca cero ni un texto inventado.
 */

type Importe = Readonly<{ moneda: string; monto: string }>;

export type HojaParaCobrarALaCuenta = Readonly<{
  cliente: Readonly<{ id: string; nombre: string | null }>;
  ticket: Readonly<{
    ticketId: string;
    numero: number;
    canal: "SALON" | "MOSTRADOR";
    sucursalId: string;
    fechaNegocio: string;
    /** El ejemplar vigente que se vio: el servidor cobra solo ese. */
    ejemplarId: string;
    total: Importe;
    venceEl: string | null;
    vencida: boolean;
    sucursal: string | null;
  }>;
  cajas: readonly Readonly<{
    cajaId: string;
    nombre: string;
    estado: "SIN_SESION" | "ABIERTA" | "EN_CIERRE";
    sesionId: string | null;
    fechaDeNegocio: string | null;
    jornadaVencida: boolean;
  }>[];
  jornadaActual: Readonly<{
    fechaDeNegocio: string;
    estado: "ABIERTA" | "EN_AUDITORIA" | "CERRADA";
  }>;
  opciones: OpcionesParaCobrar | null;
}>;

export type TicketCobradoALaCuenta = Readonly<{
  ticketId: string;
  numero: number;
  cobranzaId: string;
  cliente: Readonly<{ id: string; nombre: string | null }>;
  total: Importe;
  fechaDeCobro: string;
  jornadaVencida: boolean;
  saldoDelCliente: Importe | null;
  yaExistia: boolean;
}>;

export type CajaParaElegir = Readonly<{ cajaId: string; etiqueta: string; fechaDeNegocio: string }>;

/**
 * Las cajas donde se puede cobrar: las que tienen la sesión abierta HOY, con la jornada de hoy abierta. Con el día en auditoría o cerrado, o una sesión de un día anterior, no se ofrece ninguna (el
 * servidor rechazaría el cobro igual). Nace cerrado: sin una caja que cumpla todo, la lista es vacía.
 */
export function cajasParaElegir(hoja: HojaParaCobrarALaCuenta): readonly CajaParaElegir[] {
  if (hoja.jornadaActual.estado !== "ABIERTA") return [];
  const sucursal = hoja.ticket.sucursal ?? SIN_DATO;
  return hoja.cajas.flatMap((c) =>
    c.estado === "ABIERTA" && !c.jornadaVencida && c.fechaDeNegocio !== null
      ? [
          {
            cajaId: c.cajaId,
            etiqueta: opcionDeCaja(c.nombre, sucursal),
            fechaDeNegocio: c.fechaDeNegocio,
          },
        ]
      : [],
  );
}

/** La caja con la que arranca la hoja: la única abierta; con varias, ninguna (se elige a propósito, no se asume una). */
export const cajaInicial = (cajas: readonly CajaParaElegir[]): string =>
  cajas.length === 1 ? (cajas[0] as CajaParaElegir).cajaId : "";

/** «Este cobro entra en la caja del {fecha}» de la caja elegida; vacío sin caja elegida. */
export function lineaDeLaCaja(cajas: readonly CajaParaElegir[], cajaId: string): string {
  const caja = cajas.find((c) => c.cajaId === cajaId);
  return caja === undefined ? "" : entraEnLaCaja(formatearFecha(caja.fechaDeNegocio));
}

type HojaArmada = Readonly<{
  cliente: string;
  ticket: string;
  venceEl: string;
  vencida: string | null;
  total: string;
}>;

/** Las filas de la hoja con sus valores ya formateados (fechas `dd/mm/aaaa`, importes en pesos). */
export function armarLaHoja(
  hoja: HojaParaCobrarALaCuenta,
  textos: TextosDeCobrarACuenta,
): HojaArmada {
  const t = hoja.ticket;
  return {
    cliente: hoja.cliente.nombre ?? SIN_DATO,
    ticket: valorDelTicket(
      String(t.numero),
      t.canal === "SALON" ? textos.salon : textos.mostrador,
      formatearFecha(t.fechaNegocio),
    ),
    venceEl: t.venceEl === null ? SIN_DATO : formatearFecha(t.venceEl),
    vencida: t.vencida ? textos.vencida : null,
    total: formatearImporte(t.total.monto),
  };
}

/** El texto del botón: «Cobrar $ 1.000,00». */
export const textoDeCobrar = (hoja: HojaParaCobrarALaCuenta): string =>
  cobrarImporte(formatearImporte(hoja.ticket.total.monto));

/** El pago que arranca la hoja: el medio inicial (el efectivo si hay) por el total del ticket; `null` si el servidor no ofrece ningún medio. */
export function pagoInicial(hoja: HojaParaCobrarALaCuenta, clave: string): PagoEnEdicion | null {
  const medio = hoja.opciones === null ? null : medioInicial(hoja.opciones.medios);
  return medio === null ? null : pagoNuevo(clave, medio.id, hoja.ticket.total.monto);
}

/**
 * ¿Se puede cobrar? Hay permiso, una caja elegida de las ofrecidas, un medio de los ofrecidos y los datos del medio bien escritos. Es una ayuda para apagar el botón; no decide nada: el servidor valida de
 * nuevo todo. El importe es siempre el total del ticket (una sola fila), así que la cuenta de «cubre justo el total» la hace el mismo modelo del cobro del mostrador.
 */
export function sePuedeCobrar(entrada: {
  hoja: HojaParaCobrarALaCuenta;
  puedeCobrar: boolean;
  cajaId: string;
  pago: PagoEnEdicion | null;
}): boolean {
  const { hoja, puedeCobrar, cajaId, pago } = entrada;
  if (!puedeCobrar || pago === null || hoja.opciones === null) return false;
  if (!cajasParaElegir(hoja).some((c) => c.cajaId === cajaId)) return false;
  return estadoDelCobro(hoja.ticket.total, [pago], hoja.opciones.medios).listo;
}

/**
 * El pedido de cobro que sale para el servidor: el ticket y el ejemplar que se vieron, la caja, el medio, la cuenta de cobro (o ninguna) y solo los datos que el medio admite y se escribieron. SIN importe.
 * `null` si el medio ya no figura en las opciones: nunca un pedido a medias.
 */
export function pedidoDeCobrarACuenta(entrada: {
  hoja: HojaParaCobrarALaCuenta;
  cajaId: string;
  pago: PagoEnEdicion;
}): Readonly<Record<string, unknown>> | null {
  const { hoja, cajaId, pago } = entrada;
  const medio = hoja.opciones?.medios.find((m) => m.id === pago.medioId);
  if (medio === undefined) return null;
  return {
    ticketId: hoja.ticket.ticketId,
    ejemplarId: hoja.ticket.ejemplarId,
    cajaId,
    medioDePagoId: pago.medioId,
    cuentaDeCobroId: pago.cuentaId === "" ? null : pago.cuentaId,
    ...datosParaEnviar(pago, medio),
  };
}

type CobradoArmado = Readonly<{ detalle: string }>;

/**
 * El estado «Cobrado»: el detalle con el número del ticket, la fecha de la caja donde cayó, el medio (en minúscula, como sigue a «por»), el importe del servidor y el saldo del cliente después. Sin
 * permiso para ver la cuenta el servidor no devuelve el saldo y sale «—»: nunca un saldo inventado ni el cobro escondido.
 */
export function armarLoCobrado(
  cobrado: TicketCobradoALaCuenta,
  medio: MedioParaCobrar | undefined,
): CobradoArmado {
  return {
    detalle: detalleDelCobrado({
      n: String(cobrado.numero),
      fecha: formatearFecha(cobrado.fechaDeCobro),
      medio: medio === undefined ? SIN_DATO : nombreDelMedio(medio).toLowerCase(),
      importe: formatearImporte(cobrado.total.monto),
      cliente: cobrado.cliente.nombre ?? SIN_DATO,
      saldo:
        cobrado.saldoDelCliente === null
          ? SIN_DATO
          : formatearImporte(cobrado.saldoDelCliente.monto),
    }),
  };
}
