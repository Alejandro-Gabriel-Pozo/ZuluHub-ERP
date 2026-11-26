import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";

/**
 * Los textos de «Cobrar un ticket a cuenta» ya resueltos (CC-5 B2b; maqueta P4, `DEC-CCL-009`). Los quince propios salen de `cuenta_corriente.cobro.*`; el resto reutiliza claves que ya existían
 * (Cliente, Ticket, Vencida, Cobrado, Cancelar, Salón y Mostrador). Lo que lleva datos (`{n} · {canal} · {fecha}`, `Cobrar {importe}`…) lo resuelven las funciones de abajo: ningún texto se arma a mano.
 */
export type TextosDeCobrarACuenta = Readonly<{
  titulo: string;
  nota: string;
  cliente: string;
  ticket: string;
  venciaEl: string;
  vencida: string;
  totalACobrar: string;
  medio: string;
  caja: string;
  sinCaja: string;
  cobrado: string;
  verCuenta: string;
  cobrarOtro: string;
  cancelar: string;
  salon: string;
  mostrador: string;
}>;

export function textosDeCobrarACuenta(): TextosDeCobrarACuenta {
  return {
    titulo: texto({}, "cuenta_corriente.cobro.titulo"),
    nota: texto({}, "cuenta_corriente.cobro.nota"),
    cliente: texto({}, "fiscal.pantalla.rotulo_cliente"),
    ticket: texto({}, "fiscal.pantalla.imprimir_formato_ticket"),
    venciaEl: texto({}, "cuenta_corriente.cobro.vencia_el"),
    vencida: texto({}, "cuenta_corriente.movimiento.vencida"),
    totalACobrar: texto({}, "cuenta_corriente.cobro.total_a_cobrar"),
    medio: texto({}, "cuenta_corriente.cobro.medio"),
    caja: texto({}, "cuenta_corriente.cobro.caja"),
    sinCaja: texto({}, "cuenta_corriente.cobro.sin_caja"),
    cobrado: texto({}, "ventas.cobro.cobrado"),
    verCuenta: texto({}, "cuenta_corriente.cobro.ver_cuenta"),
    cobrarOtro: texto({}, "cuenta_corriente.cobro.cobrar_otro"),
    cancelar: texto({}, "catalogo.accion.cancelar"),
    salon: texto({}, "salon.texto.grupo_salon"),
    mostrador: texto({}, "navegacion.grupo.mostrador"),
  };
}

/** «4821 · Salón · 12/10/2026». */
export const valorDelTicket = (n: string, canal: string, fecha: string): string =>
  texto({}, "cuenta_corriente.cobro.ticket_valor", { n, canal, fecha });

/** «Caja 1 · Centro · sesión abierta hoy». */
export const opcionDeCaja = (caja: string, sucursal: string): string =>
  texto({}, "cuenta_corriente.cobro.caja_opcion", { caja, sucursal });

/** «Este cobro entra en la caja del 09/11/2026.». */
export const entraEnLaCaja = (fecha: string): string =>
  texto({}, "cuenta_corriente.cobro.entra_en_la_caja", { fecha });

/** «Cobrar $ 1.000,00». */
export const cobrarImporte = (importe: string): string =>
  texto({}, "cuenta_corriente.cobro.cobrar", { importe });

/** El detalle del estado «Cobrado». */
export const detalleDelCobrado = (datos: {
  n: string;
  fecha: string;
  medio: string;
  importe: string;
  cliente: string;
  saldo: string;
}): string => texto({}, "cuenta_corriente.cobro.cobrado_detalle", datos);
