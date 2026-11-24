import { texto } from "../../../../../../src/capacidades/vocabulario/vocabulario";

/**
 * Los textos de «Nueva compra» ya resueltos (Compras PR 6b). Acá no se arma ningún texto nuevo: se eligen los aprobados del catálogo (cada uno con su fuente en su catálogo; los de compras salen de
 * `compra.html`, «Textos aprobados» del 09/11/2026). Lo que la maqueta dice y no tiene texto aprobado NO se escribe: va a «Pendiente de texto» del informe del PR.
 */
export type TextosDeNuevaCompra = Readonly<{
  proveedor: string;
  agregarProveedor: string;
  yaExisteUnProveedor: string;
  agregar: string;
  cancelar: string;
  cerrar: string;
  persona: string;
  empresa: string;
  nombre: string;
  razonSocial: string;
  agregarProducto: string;
  comoSeCompra: string;
  cantidad: string;
  precioPor: string;
  precio: string;
  entraATuStock: string;
  costoPorUnidadDeStock: string;
  sinPrecio: string;
  total: string;
  remitoDelProveedor: string;
  puntoDeVenta: string;
  numero: string;
  fechaDelRemito: string;
  deposito: string;
  quitar: string;
  sinElegir: string;
  comprarYRecibir: string;
  enviando: string;
  reintentar: string;
  sinResultados: string;
}>;

export function textosDeNuevaCompra(): TextosDeNuevaCompra {
  return {
    proveedor: texto({}, "compras.compra.proveedor"),
    agregarProveedor: texto({}, "compras.ficha.agregar_proveedor"),
    yaExisteUnProveedor: texto({}, "compras.ficha.ya_existe_un_proveedor_con_ese_nombre"),
    agregar: texto({}, "compras.ficha.agregar"),
    cancelar: texto({}, "catalogo.accion.cancelar"),
    cerrar: texto({}, "vidriera.producto.cerrar"),
    persona: texto({}, "clientes.lista.persona"),
    empresa: texto({}, "clientes.lista.empresa"),
    nombre: texto({}, "catalogo.dato.nombre"),
    razonSocial: texto({}, "clientes.lista.razon_social"),
    agregarProducto: texto({}, "catalogo.seccion.agregar_producto"),
    comoSeCompra: texto({}, "compras.compra.como_se_compra"),
    cantidad: texto({}, "compras.compra.cantidad"),
    precioPor: texto({}, "compras.compra.precio_por"),
    precio: texto({}, "fiscal.pantalla.emitir_precio"),
    entraATuStock: texto({}, "compras.compra.entra_a_tu_stock"),
    costoPorUnidadDeStock: texto({}, "compras.compra.costo_por_unidad_de_stock"),
    sinPrecio: texto({}, "catalogo.precio.sin_precio"),
    total: texto({}, "fiscal.pantalla.rotulo_total"),
    remitoDelProveedor: texto({}, "compras.recepcion.remito_del_proveedor"),
    puntoDeVenta: texto({}, "fiscal.pantalla.rotulo_punto_de_venta"),
    numero: texto({}, "compras.recepcion.numero"),
    fechaDelRemito: texto({}, "compras.recepcion.fecha_del_remito"),
    deposito: texto({}, "compras.compra.deposito"),
    quitar: texto({}, "catalogo.accion.quitar"),
    sinElegir: texto({}, "catalogo.dato.sin_elegir"),
    comprarYRecibir: texto({}, "compras.compra.comprar_y_recibir"),
    enviando: texto({}, "conexion.enviando"),
    reintentar: texto({}, "estado.reintentar"),
    sinResultados: texto({}, "catalogo.lista.sin_resultados"),
  };
}

/** «3 resultados» / «1 resultado» / «Sin resultados»: lo que se anuncia debajo de un buscador. Los textos del buscador de la vidriera, el mismo mecanismo. */
export function anuncioDeResultados(cantidad: number, sinResultados: string): string {
  if (cantidad === 0) return sinResultados;
  return cantidad === 1
    ? texto({}, "vidriera.buscar.un_resultado")
    : texto({}, "vidriera.buscar.resultados", { cantidad: String(cantidad) });
}
