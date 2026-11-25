import { texto } from "../../../../../../src/capacidades/vocabulario/vocabulario";

/**
 * Los textos de la ficha del proveedor de compras ya resueltos (Compras PR 4). Acá no se arma ningún texto nuevo: son los aprobados el 09/11/2026 en `compra.html` («Textos aprobados», ficha del
 * proveedor, pedidos y modales) que ya tienen su clave en `catalogo-compras.ts`, más los de uso común del catálogo. Lo que la maqueta dice y no tiene clave aprobada NO se escribe: va a
 * «Pendiente de texto» del informe del PR.
 */
export type TextosDeProveedor = Readonly<{
  volver: string;
  cuit: string;
  datosDelDirectorio: string;
  comprobantesQueEmite: string;
  porSer: string;
  emite: string;
  condicionNoDefineLaLetra: string;
  ningunoCargado: string;
  puntosDeVenta: string;
  sinPuntosDeVenta: string;
  queLeCompramos: string;
  todaviaNoSeLeComproNada: string;
  ultimaCompra: string;
  facturasYNotas: string;
  todaviaNoTieneFacturas: string;
  verTodas: string;
  anulada: string;
  agregarPuntoDeVenta: string;
  agregarOtroComprobante: string;
  pedirPuntoDeVenta: string;
  pedirOtroComprobante: string;
  dejarDeUsar: string;
  pedidosPendientes: string;
  pedidoEl: string;
  faltaQueLoApruebe: string;
  aprobar: string;
  rechazar: string;
  enviarPedido: string;
  agregar: string;
  cancelar: string;
  cerrar: string;
  tipo: string;
  numeroDelPuntoDeVenta: string;
  seAgregaALaFichaDe: string;
  despuesSoloSeEligeEntreLosDeLaFicha: string;
  pedidoLoApruebaQuienAdministra: string;
  lasFacturasCargadasNoCambian: string;
  puntoDeVenta: string;
}>;

export function textosDeProveedor(): TextosDeProveedor {
  return {
    volver: texto({}, "ventas.ticket.volver"),
    cuit: texto({}, "compras.ficha.cuit"),
    datosDelDirectorio: texto({}, "compras.ficha.datos_del_directorio"),
    comprobantesQueEmite: texto({}, "compras.ficha.comprobantes_que_emite"),
    porSer: texto({}, "compras.ficha.por_ser"),
    emite: texto({}, "compras.ficha.emite"),
    condicionNoDefineLaLetra: texto({}, "compras.ficha.condicion_no_define_la_letra"),
    ningunoCargado: texto({}, "compras.ficha.ninguno_cargado"),
    puntosDeVenta: texto({}, "compras.ficha.puntos_de_venta"),
    sinPuntosDeVenta: texto({}, "compras.ficha.sin_puntos_de_venta"),
    queLeCompramos: texto({}, "compras.ficha.que_le_compramos"),
    todaviaNoSeLeComproNada: texto({}, "compras.ficha.todavia_no_se_le_compro_nada"),
    ultimaCompra: texto({}, "compras.ficha.ultima_compra"),
    facturasYNotas: texto({}, "compras.ficha.facturas_y_notas"),
    todaviaNoTieneFacturas: texto({}, "compras.ficha.todavia_no_tiene_facturas"),
    verTodas: texto({}, "compras.ficha.ver_todas"),
    anulada: texto({}, "compras.orden.anulada"),
    agregarPuntoDeVenta: texto({}, "compras.ficha.agregar_punto_de_venta"),
    agregarOtroComprobante: texto({}, "compras.ficha.agregar_otro_comprobante"),
    pedirPuntoDeVenta: texto({}, "compras.ficha.pedir_punto_de_venta"),
    pedirOtroComprobante: texto({}, "compras.ficha.pedir_otro_comprobante"),
    dejarDeUsar: texto({}, "compras.ficha.dejar_de_usar"),
    pedidosPendientes: texto({}, "compras.ficha.pedidos_pendientes"),
    pedidoEl: texto({}, "compras.ficha.pedido_el"),
    faltaQueLoApruebe: texto({}, "compras.ficha.falta_que_lo_apruebe"),
    aprobar: texto({}, "compras.ficha.aprobar"),
    rechazar: texto({}, "compras.ficha.rechazar"),
    enviarPedido: texto({}, "compras.ficha.enviar_pedido"),
    agregar: texto({}, "compras.ficha.agregar"),
    cancelar: texto({}, "catalogo.accion.cancelar"),
    cerrar: texto({}, "vidriera.producto.cerrar"),
    tipo: texto({}, "compras.factura.tipo"),
    numeroDelPuntoDeVenta: texto({}, "compras.ficha.numero_del_punto_de_venta"),
    seAgregaALaFichaDe: texto({}, "compras.ficha.se_agrega_a_la_ficha_de"),
    despuesSoloSeEligeEntreLosDeLaFicha: texto(
      {},
      "compras.ficha.despues_solo_se_elige_entre_los_de_la_ficha",
    ),
    pedidoLoApruebaQuienAdministra: texto({}, "compras.ficha.pedido_lo_aprueba_quien_administra"),
    lasFacturasCargadasNoCambian: texto({}, "compras.ficha.las_facturas_cargadas_no_cambian"),
    puntoDeVenta: texto({}, "fiscal.pantalla.rotulo_punto_de_venta"),
  };
}
