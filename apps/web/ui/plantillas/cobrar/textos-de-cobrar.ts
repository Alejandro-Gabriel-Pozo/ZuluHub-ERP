import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";

/**
 * Los textos de la hoja de COBRAR ya resueltos (`ventas.cobro.*` y `ventas.ticket.*`, cada uno con su fuente en `catalogo-ventas.ts`). Aparte del modelo para que cada archivo sea chico.
 * Acá no se arma ningún texto nuevo: se eligen los aprobados.
 */

export type TextosDeCobrar = Readonly<{
  cobrar: string;
  cobrado: string;
  total: string;
  medio: string;
  importe: string;
  cuentaDeCobro: string;
  sinElegir: string;
  vuelto: string;
  faltaCobrar: string;
  cobroCompleto: string;
  sobran: string;
  importeNoValido: string;
  abrirLaCaja: string;
  agregarOtroMedio: string;
  quitar: string;
  titulo: string;
  volverALaCuenta: string;
  resultado: string;
  noSePudo: string;
  volverAlCobro: string;
  abrirCaja: string;
  cupon: string;
  ultimos4: string;
  marca: string;
  cuotas: string;
  dni: string;
  opcional: string;
  anular: string;
  motivo: string;
  motivoObligatorio: string;
  anulado: string;
  nuevaVenta: string;
  cancelar: string;
  noPermitido: string;
  enviando: string;
  sinConexion: string;
  noSePuedeEnviar: string;
  verificando: string;
  cerrar: string;
}>;

/** Los textos de la hoja ya resueltos. Reutiliza los aprobados que ya tienen clave en otro módulo cuando son el mismo texto y la misma función («Sin elegir», «Cerrar», los de conexión). */
export function textosDeCobrar(): TextosDeCobrar {
  return {
    cobrar: texto({}, "ventas.cobro.cobrar"),
    cobrado: texto({}, "ventas.cobro.cobrado"),
    total: texto({}, "ventas.venta.total"),
    medio: texto({}, "ventas.cobro.medio"),
    importe: texto({}, "ventas.cobro.importe"),
    cuentaDeCobro: texto({}, "ventas.cobro.cuenta_de_cobro"),
    sinElegir: texto({}, "catalogo.dato.sin_elegir"),
    vuelto: texto({}, "ventas.cobro.vuelto"),
    faltaCobrar: texto({}, "ventas.cobro.falta_cobrar"),
    cobroCompleto: texto({}, "ventas.cobro.cobro_completo"),
    sobran: texto({}, "ventas.cobro.sobran"),
    importeNoValido: texto({}, "ventas.cobro.importe_no_valido"),
    abrirLaCaja: texto({}, "ventas.cobro.abri_la_caja"),
    agregarOtroMedio: texto({}, "ventas.cobro.agregar_otro_medio"),
    quitar: texto({}, "ventas.venta.quitar"),
    titulo: texto({}, "ventas.cobro.titulo"),
    volverALaCuenta: texto({}, "ventas.cobro.volver_a_la_cuenta"),
    resultado: texto({}, "ventas.cobro.resultado"),
    noSePudo: texto({}, "ventas.cobro.no_se_pudo"),
    volverAlCobro: texto({}, "ventas.cobro.volver_al_cobro"),
    abrirCaja: texto({}, "caja.sesion.abrir"),
    cupon: texto({}, "ventas.cobro.dato.cupon"),
    ultimos4: texto({}, "ventas.cobro.dato.ultimos4"),
    marca: texto({}, "ventas.cobro.dato.marca"),
    cuotas: texto({}, "ventas.cobro.dato.cuotas"),
    dni: texto({}, "ventas.cobro.dato.dni"),
    opcional: texto({}, "ventas.cobro.dato.opcional"),
    anular: texto({}, "ventas.ticket.anular"),
    motivo: texto({}, "ventas.ticket.motivo"),
    motivoObligatorio: texto({}, "ventas.ticket.motivo_obligatorio"),
    anulado: texto({}, "ventas.ticket.anulado"),
    nuevaVenta: texto({}, "ventas.venta.nueva"),
    cancelar: texto({}, "ventas.venta.cancelar"),
    noPermitido: texto({}, "ventas.error.accion_no_permitida"),
    enviando: texto({}, "conexion.enviando"),
    sinConexion: texto({}, "conexion.sin_conexion"),
    noSePuedeEnviar: texto({}, "conexion.no_se_puede_enviar"),
    verificando: texto({}, "conexion.verificando"),
    cerrar: texto({}, "vidriera.producto.cerrar"),
  };
}

/** «Ticket N.º 12». */
export const rotuloDelTicket = (numero: number): string =>
  texto({}, "ventas.ticket.numero", { numero: String(numero) });

/** El rótulo de un dato: «Cupón (opcional)», como en la maqueta de los datos del cobro (el texto «(opcional)» ya lleva sus paréntesis). */
export const rotuloDeUnDato = (dato: string, opcional: string): string => `${dato} ${opcional}`;
