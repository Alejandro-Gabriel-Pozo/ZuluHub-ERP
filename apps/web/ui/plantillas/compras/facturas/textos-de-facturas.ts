import { texto } from "../../../../../../src/capacidades/vocabulario/vocabulario";

/**
 * Los textos de «Facturas» ya resueltos (Compras 4): la lista, el detalle, «Cargar factura» y «Conciliar». Cada texto sale del catálogo con su fuente (`catalogo-compras.ts` y la ficha `ficha-de-facturas.ts`).
 * Lo que no tiene texto aprobado NO se escribe acá: va a la lista de textos por aprobar del PR.
 */
export type TextosDeFacturas = Readonly<{
  titulo: string;
  cargarFactura: string;
  notasDeCredito: string;
  proveedor: string;
  recepcion: string;
  totalSegunLaFactura: string;
  conciliar: string;
  validarConciliacion: string;
  facturado: string;
  recibido: string;
  conciliado: string;
  aConciliar: string;
  conciliaciones: string;
  tomarElCosto: string;
  precioNeto: string;
  anularConciliacion: string;
  anular: string;
  cancelar: string;
  cerrar: string;
  anulada: string;
  facturadaFaltaRecibir: string;
  faltaConciliar: string;
  conciliadaEnParte: string;
  todoCoincide: string;
  sinResultados: string;
  paginaSiguiente: string;
  enviando: string;
  reintentar: string;
}>;

export function textosDeFacturas(): TextosDeFacturas {
  return {
    titulo: texto({}, "compras.factura.titulo_lista"),
    cargarFactura: texto({}, "compras.factura.cargar_factura"),
    notasDeCredito: texto({}, "compras.factura.notas_de_credito"),
    proveedor: texto({}, "compras.compra.proveedor"),
    recepcion: texto({}, "compras.recepcion.recepcion"),
    totalSegunLaFactura: texto({}, "compras.factura.total_segun_la_factura"),
    conciliar: texto({}, "compras.conciliacion.conciliar"),
    validarConciliacion: texto({}, "compras.conciliacion.validar_conciliacion"),
    facturado: texto({}, "compras.conciliacion.facturado"),
    recibido: texto({}, "compras.conciliacion.recibido"),
    conciliado: texto({}, "compras.conciliacion.conciliado"),
    aConciliar: texto({}, "compras.conciliacion.a_conciliar"),
    conciliaciones: texto({}, "compras.conciliacion.conciliaciones"),
    tomarElCosto: texto({}, "compras.factura.tomar_costo"),
    precioNeto: texto({}, "compras.factura.precio_neto"),
    anularConciliacion: texto({}, "compras.conciliacion.anular"),
    anular: texto({}, "ventas.ticket.anular"),
    cancelar: texto({}, "catalogo.accion.cancelar"),
    cerrar: texto({}, "vidriera.producto.cerrar"),
    anulada: texto({}, "compras.orden.anulada"),
    facturadaFaltaRecibir: texto({}, "compras.compra.facturada_falta_recibir"),
    faltaConciliar: texto({}, "compras.conciliacion.estado_falta_conciliar"),
    conciliadaEnParte: texto({}, "compras.conciliacion.estado_conciliada_en_parte"),
    todoCoincide: texto({}, "compras.conciliacion.todo_coincide"),
    sinResultados: texto({}, "catalogo.lista.sin_resultados"),
    paginaSiguiente: texto({}, "fiscal.pantalla.listado_pagina_siguiente"),
    enviando: texto({}, "conexion.enviando"),
    reintentar: texto({}, "estado.reintentar"),
  };
}
