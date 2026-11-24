import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";

/**
 * Los textos de «Compras» y «Compra» ya resueltos (Compras PR 3). Acá no se arma ningún texto nuevo: se eligen los aprobados del catálogo (cada uno con su fuente en `catalogo-compras.ts` y,
 * los de otros módulos con el mismo texto, en su catálogo). Lo que la maqueta dice y no tiene texto aprobado NO se escribe: va a «Pendiente de texto» del informe del PR.
 */
export type TextosDeCompras = Readonly<{
  titulo: string;
  compra: string;
  todas: string;
  sinFacturar: string;
  recibidaSinFacturar: string;
  anulada: string;
  sinPrecio: string;
  desde: string;
  hasta: string;
  estado: string;
  aplicarFiltros: string;
  paginaSiguiente: string;
  sinResultados: string;
  verTodas: string;
  volver: string;
  motivo: string;
  remitoDelProveedor: string;
  sinRemito: string;
  entraATuStock: string;
  costoPorUnidadDeStock: string;
  total: string;
  vence: string;
  noPermitido: string;
  corregir: string;
  antes: string;
  anular: string;
  cancelar: string;
  cerrar: string;
  precio: string;
  precioPor: string;
  /** «Corregido por ana@ejemplo.com · 24/11/2026 21:14». */
  corregidoPor: (persona: string, cuando: string) => string;
  nuevaCompra: string;
}>;

export function textosDeCompras(): TextosDeCompras {
  return {
    titulo: texto({}, "compras.compra.compras"),
    compra: texto({}, "compras.compra.compra"),
    todas: texto({}, "fiscal.pantalla.listado_todas"),
    sinFacturar: texto({}, "compras.compra.sin_facturar"),
    recibidaSinFacturar: texto({}, "compras.compra.recibida_sin_facturar"),
    anulada: texto({}, "compras.orden.anulada"),
    sinPrecio: texto({}, "catalogo.precio.sin_precio"),
    desde: texto({}, "fiscal.pantalla.listado_rotulo_desde"),
    hasta: texto({}, "fiscal.pantalla.listado_rotulo_hasta"),
    estado: texto({}, "fiscal.pantalla.listado_rotulo_estado"),
    aplicarFiltros: texto({}, "fiscal.pantalla.listado_aplicar"),
    paginaSiguiente: texto({}, "fiscal.pantalla.listado_pagina_siguiente"),
    sinResultados: texto({}, "catalogo.lista.sin_resultados"),
    verTodas: texto({}, "compras.ficha.ver_todas"),
    volver: texto({}, "ventas.ticket.volver"),
    motivo: texto({}, "ventas.ticket.motivo"),
    remitoDelProveedor: texto({}, "compras.recepcion.remito_del_proveedor"),
    sinRemito: texto({}, "compras.recepcion.sin_remito"),
    entraATuStock: texto({}, "compras.compra.entra_a_tu_stock"),
    costoPorUnidadDeStock: texto({}, "compras.compra.costo_por_unidad_de_stock"),
    total: texto({}, "fiscal.pantalla.rotulo_total"),
    vence: texto({}, "compras.control.vence"),
    noPermitido: texto({}, "compras.error.sin_permiso"),
    corregir: texto({}, "compras.correccion.corregir"),
    antes: texto({}, "compras.correccion.antes"),
    anular: texto({}, "ventas.ticket.anular"),
    cancelar: texto({}, "catalogo.accion.cancelar"),
    cerrar: texto({}, "vidriera.producto.cerrar"),
    precio: texto({}, "fiscal.pantalla.emitir_precio"),
    precioPor: texto({}, "compras.compra.precio_por"),
    corregidoPor: (persona, cuando) => texto({}, "cierre.corregido_por", { persona, cuando }),
    nuevaCompra: texto({}, "compras.compra.nueva_compra"),
  };
}
