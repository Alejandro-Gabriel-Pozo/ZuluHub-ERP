import { texto } from "../../../../../../src/capacidades/vocabulario/vocabulario";

/**
 * Los textos de «Recepciones» ya resueltos (Compras 4): la lista, el detalle, «Confirmar recepción» y «Anular recepción». Cada texto sale del catálogo con su fuente (`catalogo-compras.ts` y la ficha
 * `ficha-de-recepciones.ts`). Lo que no tiene texto aprobado NO se escribe acá: va a la lista de textos por aprobar del PR.
 */
export type TextosDeRecepciones = Readonly<{
  titulo: string;
  recepcion: string;
  recibir: string;
  confirmar: string;
  anular: string;
  anularRecepcion: string;
  motivo: string;
  cancelar: string;
  cerrar: string;
  deposito: string;
  sinElegir: string;
  remitoDelProveedor: string;
  sinRemito: string;
  anulada: string;
  porConfirmar: string;
  recibidaSinFacturar: string;
  facturadaEnParte: string;
  facturada: string;
  sinResultados: string;
  paginaSiguiente: string;
  corregirLoRecibido: string;
  corregir: string;
  cantidadRecibida: string;
  motivoDeLaCorreccion: string;
  causaErrorDeCarga: string;
  causaRepartoInterno: string;
  causaFaltanteDelProveedor: string;
  avisoRepartoInterno: string;
  nota: string;
  correcciones: string;
  enviando: string;
  reintentar: string;
}>;

export function textosDeRecepciones(): TextosDeRecepciones {
  return {
    titulo: texto({}, "compras.recepcion.titulo_lista"),
    recepcion: texto({}, "compras.recepcion.recepcion"),
    recibir: texto({}, "compras.recepcion.recibir"),
    confirmar: texto({}, "compras.recepcion.validar_recepcion"),
    anular: texto({}, "ventas.ticket.anular"),
    anularRecepcion: texto({}, "compras.recepcion.anular_recepcion"),
    motivo: texto({}, "ventas.ticket.motivo"),
    cancelar: texto({}, "catalogo.accion.cancelar"),
    cerrar: texto({}, "vidriera.producto.cerrar"),
    deposito: texto({}, "compras.compra.deposito"),
    sinElegir: texto({}, "catalogo.dato.sin_elegir"),
    remitoDelProveedor: texto({}, "compras.recepcion.remito_del_proveedor"),
    sinRemito: texto({}, "compras.recepcion.sin_remito"),
    anulada: texto({}, "compras.orden.anulada"),
    porConfirmar: texto({}, "compras.recepcion.estado_por_validar"),
    recibidaSinFacturar: texto({}, "compras.compra.recibida_sin_facturar"),
    facturadaEnParte: texto({}, "compras.recepcion.estado_facturada_en_parte"),
    facturada: texto({}, "compras.recepcion.estado_facturada"),
    sinResultados: texto({}, "catalogo.lista.sin_resultados"),
    paginaSiguiente: texto({}, "fiscal.pantalla.listado_pagina_siguiente"),
    corregirLoRecibido: texto({}, "compras.recepcion.corregir_recibido"),
    corregir: texto({}, "compras.correccion.corregir"),
    cantidadRecibida: texto({}, "compras.recepcion.cantidad_recibida"),
    motivoDeLaCorreccion: texto({}, "compras.recepcion.motivo_correccion"),
    causaErrorDeCarga: texto({}, "compras.recepcion.causa_error_de_carga"),
    causaRepartoInterno: texto({}, "compras.recepcion.causa_reparto_interno"),
    causaFaltanteDelProveedor: texto({}, "compras.recepcion.causa_faltante"),
    avisoRepartoInterno: texto({}, "compras.recepcion.aviso_reparto"),
    nota: texto({}, "clientes.formulario.nota"),
    correcciones: texto({}, "cierre.control.correcciones"),
    enviando: texto({}, "conexion.enviando"),
    reintentar: texto({}, "estado.reintentar"),
  };
}
