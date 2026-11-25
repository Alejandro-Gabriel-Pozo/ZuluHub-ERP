import type {
  ColumnaDeCabecera,
  ColumnaDeDetalle,
  ColumnaDeResumen,
  RotulosDeExportacion,
} from "../modulos/compras/publico";
import { texto } from "../capacidades/vocabulario/vocabulario";

/**
 * Los textos del archivo de compras (encabezados, nombres de hoja y valores de celda) sacados del catálogo de textos aprobados: ninguno se escribe a mano. Un identificador de columna
 * sin texto no compila (cada tabla es exhaustiva por su columna). Los que ya existían (proveedor, sucursal, tipo, letra, producto, estado) se reutilizan desde su clave.
 */

const t = (clave: Parameters<typeof texto>[1]): string => texto({}, clave);

const CABECERA: Readonly<Record<ColumnaDeCabecera, string>> = {
  id: t("compras.exportacion.cabecera.id"),
  numero: t("compras.exportacion.cabecera.numero"),
  estado: t("fiscal.pantalla.listado_rotulo_estado"),
  fecha_de_negocio: t("compras.exportacion.cabecera.fecha_de_negocio"),
  sucursal: t("sucursal.etiqueta"),
  proveedor: t("compras.compra.proveedor"),
  cuit: t("compras.exportacion.cabecera.cuit"),
  tipo: t("compras.factura.tipo"),
  letra: t("fiscal.pantalla.listado_rotulo_letra"),
  punto_de_venta: t("compras.exportacion.cabecera.punto_de_venta"),
  numero_del_comprobante: t("compras.exportacion.cabecera.numero_del_comprobante"),
  fecha_del_comprobante: t("compras.exportacion.cabecera.fecha_del_comprobante"),
  moneda: t("compras.exportacion.cabecera.moneda"),
  neto_gravado: t("compras.exportacion.cabecera.neto_gravado"),
  no_gravado: t("compras.exportacion.cabecera.no_gravado"),
  exento: t("compras.exportacion.cabecera.exento"),
  iva: t("compras.exportacion.cabecera.iva"),
  tributos: t("compras.exportacion.cabecera.tributos"),
  total_calculado: t("compras.exportacion.cabecera.total_calculado"),
  total_segun_factura: t("compras.exportacion.cabecera.total_segun_factura"),
  importe_de_las_lineas: t("compras.exportacion.cabecera.importe_de_las_lineas"),
  cantidad_de_renglones: t("compras.exportacion.cabecera.cantidad_de_renglones"),
  estado_del_pago: t("compras.exportacion.cabecera.estado_del_pago"),
  importe_abonado: t("compras.exportacion.cabecera.importe_abonado"),
  saldo: t("compras.exportacion.cabecera.saldo"),
  fecha_de_pago: t("compras.exportacion.cabecera.fecha_de_pago"),
  medio_de_pago: t("compras.exportacion.cabecera.medio_de_pago"),
  estado_de_la_factura: t("compras.exportacion.cabecera.estado_de_la_factura"),
  registrado_el: t("compras.exportacion.cabecera.registrado_el"),
  registrado_por: t("compras.exportacion.cabecera.registrado_por"),
  signo: t("compras.exportacion.cabecera.signo"),
};

const DETALLE: Readonly<Record<ColumnaDeDetalle, string>> = {
  id: CABECERA.id,
  numero: CABECERA.numero,
  linea: t("compras.exportacion.detalle.linea"),
  estado: CABECERA.estado,
  fecha_de_negocio: CABECERA.fecha_de_negocio,
  sucursal: CABECERA.sucursal,
  proveedor: CABECERA.proveedor,
  producto: t("catalogo.opciones.producto"),
  codigo_del_producto: t("compras.exportacion.detalle.codigo_del_producto"),
  clasificacion: t("compras.exportacion.detalle.clasificacion"),
  presentacion: t("compras.exportacion.detalle.presentacion"),
  cantidad_de_la_presentacion: t("compras.exportacion.detalle.cantidad_de_la_presentacion"),
  cantidad_de_compra: t("compras.exportacion.detalle.cantidad_de_compra"),
  unidad_de_compra: t("compras.exportacion.detalle.unidad_de_compra"),
  peso_real: t("compras.exportacion.detalle.peso_real"),
  cantidad_en_stock: t("compras.exportacion.detalle.cantidad_en_stock"),
  unidad_de_stock: t("compras.exportacion.detalle.unidad_de_stock"),
  precio: t("compras.exportacion.detalle.precio"),
  precio_por: t("compras.exportacion.detalle.precio_por"),
  unidad_de_precio: t("compras.exportacion.detalle.unidad_de_precio"),
  importe_vigente: t("compras.exportacion.detalle.importe_vigente"),
  costo_por_unidad_de_stock: t("compras.exportacion.detalle.costo_por_unidad_de_stock"),
  moneda: CABECERA.moneda,
  tipo: CABECERA.tipo,
  letra: CABECERA.letra,
  punto_de_venta: CABECERA.punto_de_venta,
  numero_del_comprobante: CABECERA.numero_del_comprobante,
  fecha_del_comprobante: CABECERA.fecha_del_comprobante,
  estado_del_pago: t("compras.exportacion.detalle.estado_del_pago_de_la_factura"),
  importe_abonado_derivado: t("compras.exportacion.detalle.importe_abonado_derivado"),
  costo_por_kilo_derivado: t("compras.exportacion.detalle.costo_por_kilo_derivado"),
};

const RESUMEN: Readonly<Record<ColumnaDeResumen, string>> = {
  sucursal: CABECERA.sucursal,
  producto: DETALLE.producto,
  unidad_de_compra: DETALLE.unidad_de_compra,
  compras: t("compras.exportacion.resumen.compras"),
  renglones: t("compras.exportacion.resumen.renglones"),
  cantidad_de_compra: DETALLE.cantidad_de_compra,
  cantidad_en_stock: DETALLE.cantidad_en_stock,
  unidad_de_stock: DETALLE.unidad_de_stock,
  importe_vigente: DETALLE.importe_vigente,
  moneda: CABECERA.moneda,
  renglones_sin_precio: t("compras.exportacion.resumen.renglones_sin_precio"),
  importe_abonado_derivado: DETALLE.importe_abonado_derivado,
};

export const encabezadosDeCabecera = (columnas: readonly ColumnaDeCabecera[]): string[] =>
  columnas.map((c) => CABECERA[c]);
export const encabezadosDeDetalle = (columnas: readonly ColumnaDeDetalle[]): string[] =>
  columnas.map((c) => DETALLE[c]);
export const encabezadosDeResumen = (columnas: readonly ColumnaDeResumen[]): string[] =>
  columnas.map((c) => RESUMEN[c]);

export const hojasDeLaExportacion = () =>
  ({
    cabecera: t("compras.exportacion.hoja_cabecera"),
    detalle: t("compras.exportacion.hoja_detalle"),
    resumen: t("compras.exportacion.hoja_resumen"),
  }) as const;

const MEDIOS: Readonly<Record<string, Parameters<typeof texto>[1]>> = {
  EFECTIVO: "caja.medios.tipo.efectivo",
  TARJETA_DEBITO: "caja.medios.tipo.tarjeta_debito",
  TARJETA_CREDITO: "caja.medios.tipo.tarjeta_credito",
  TRANSFERENCIA: "caja.medios.tipo.transferencia",
  QR: "caja.medios.tipo.qr",
  OTRO: "caja.medios.tipo.otro",
};

/** Los valores de celda que son texto de pantalla. Un medio de pago que el catálogo no conoce sale vacío (nunca el código técnico). */
export function rotulosDeExportacion(): RotulosDeExportacion {
  return {
    estadoDeLaCompra: (estado) =>
      estado === "ANULADA"
        ? t("compras.orden.anulada")
        : t("compras.exportacion.valor.compra_vigente"),
    tipoDeComprobante: (clase) =>
      clase === "FACTURA"
        ? t("fiscal.pantalla.tipo_factura")
        : clase === "NOTA_DE_DEBITO"
          ? t("fiscal.pantalla.tipo_nota_de_debito")
          : t("fiscal.pantalla.tipo_nota_de_credito"),
    estadoDelPago: (estado) =>
      estado === "PAGADO"
        ? t("compras.exportacion.valor.pagado")
        : estado === "ANULADO"
          ? t("caja.estado.anulado")
          : t("fiscal.pantalla.config_cartel_pendiente"),
    estadoDeLaFactura: (estado) =>
      estado === "REGISTRADO"
        ? t("compras.exportacion.valor.registrado")
        : t("caja.estado.anulado"),
    medioDePago: (medio) => {
      const clave = MEDIOS[medio];
      return clave === undefined ? "" : t(clave);
    },
    precioPorUnidad: t("catalogo.unidad.unidad"),
  };
}

/** El nombre del archivo: «compras» y el período, solo con fechas ya validadas (nada escrito por la persona). */
export const nombreDelArchivoDeCompras = (desde: string, hasta: string): string =>
  `${t("compras.exportacion.nombre_del_archivo")}_${desde}_${hasta}.xlsx`;
