/**
 * Los textos de la exportación de compras a Excel (prefijo `compras.exportacion.`; dueño, 25/11/2026): el enlace «Exportar», el nombre del archivo y de sus tres hojas, y los encabezados
 * de columna y los valores de celda que no tenían un texto aprobado. Los que ya existían se reutilizan desde sus claves (`compras.compra.proveedor`, `sucursal.etiqueta`,
 * `compras.factura.tipo`, `fiscal.pantalla.listado_rotulo_letra`, `fiscal.pantalla.listado_rotulo_estado`, `catalogo.opciones.producto`, `caja.medios.tipo.*`, `caja.estado.anulado`,
 * `fiscal.pantalla.tipo_*`, `fiscal.pantalla.config_cartel_pendiente`, `catalogo.unidad.unidad`): no se repite ninguno. Fuentes: los de dinero y fiscal los aprobó el dueño el 25/11/2026
 * («Sí a todas tus recomendaciones», lista de `plan-exportacion-de-compras-2026-11-25.md` §5) en DEC-0920; los demás los aceptó el orquestador por la delegación de la fila 173 en DEC-0921.
 * Las columnas `Nivel` y `Clase` quedaron fuera del primer corte (decisión del dueño, P5 d): sus valores son códigos técnicos.
 */

const ARCHIVO = "src/composicion/compras-exportacion-textos.ts";
const DEL_DUENO = { decision: "DEC-0920" } as const;
const DEL_ORQUESTADOR = { decision: "DEC-0921" } as const;
const uso = (nombre: string) => [{ como: "FUNCION", archivo: ARCHIVO, nombre }] as const;

const deCabecera = <T extends string>(porDefecto: T, dueno: boolean) => ({
  porDefecto,
  usos: uso("encabezadosDeCabecera"),
  fuente: dueno ? DEL_DUENO : DEL_ORQUESTADOR,
});
const deDetalle = <T extends string>(porDefecto: T, dueno: boolean) => ({
  porDefecto,
  usos: uso("encabezadosDeDetalle"),
  fuente: dueno ? DEL_DUENO : DEL_ORQUESTADOR,
});
const deResumen = <T extends string>(porDefecto: T, dueno: boolean) => ({
  porDefecto,
  usos: uso("encabezadosDeResumen"),
  fuente: dueno ? DEL_DUENO : DEL_ORQUESTADOR,
});
const DE_LA_HOJA_DE_PAGOS = { decision: "DEC-COM-004" } as const;
const dePagos = <T extends string>(porDefecto: T) => ({
  porDefecto,
  usos: uso("encabezadosDePagos"),
  fuente: DE_LA_HOJA_DE_PAGOS,
});
const deValor = <T extends string>(porDefecto: T, dueno: boolean) => ({
  porDefecto,
  usos: uso("rotulosDeExportacion"),
  fuente: dueno ? DEL_DUENO : DEL_ORQUESTADOR,
});

export const TEXTOS_DE_EXPORTACION_DE_COMPRAS = {
  "compras.exportacion.exportar": {
    porDefecto: "Exportar",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/compras/textos-de-compras.ts",
        nombre: "textosDeCompras",
      },
    ],
    fuente: DEL_ORQUESTADOR,
  },
  "compras.exportacion.nombre_del_archivo": {
    porDefecto: "compras",
    usos: uso("nombreDelArchivoDeCompras"),
    fuente: DEL_ORQUESTADOR,
  },
  "compras.exportacion.hoja_cabecera": {
    porDefecto: "Cabecera",
    usos: uso("hojasDeLaExportacion"),
    fuente: DEL_ORQUESTADOR,
  },
  "compras.exportacion.hoja_detalle": {
    porDefecto: "Detalle",
    usos: uso("hojasDeLaExportacion"),
    fuente: DEL_ORQUESTADOR,
  },
  "compras.exportacion.hoja_resumen": {
    porDefecto: "Resumen",
    usos: uso("hojasDeLaExportacion"),
    fuente: DEL_ORQUESTADOR,
  },
  "compras.exportacion.hoja_pagos": {
    porDefecto: "Pagos",
    usos: uso("hojasDeLaExportacion"),
    fuente: DE_LA_HOJA_DE_PAGOS,
  },
  // Pagos (una fila por línea de medio de cada pago vigente; el resto de sus encabezados reutiliza los de la Cabecera)
  "compras.exportacion.pagos.id_del_pago": dePagos("ID del pago"),
  // Cabecera (una fila por compra)
  "compras.exportacion.cabecera.id": deCabecera("ID de la compra", false),
  "compras.exportacion.cabecera.numero": deCabecera("Número de compra", false),
  "compras.exportacion.cabecera.fecha_de_negocio": deCabecera("Fecha de negocio", false),
  "compras.exportacion.cabecera.cuit": deCabecera("CUIT del proveedor", true),
  "compras.exportacion.cabecera.punto_de_venta": deCabecera("Punto de venta", true),
  "compras.exportacion.cabecera.numero_del_comprobante": deCabecera("Número del comprobante", true),
  "compras.exportacion.cabecera.fecha_del_comprobante": deCabecera("Fecha del comprobante", true),
  "compras.exportacion.cabecera.moneda": deCabecera("Moneda", true),
  "compras.exportacion.cabecera.neto_gravado": deCabecera("Neto gravado", true),
  "compras.exportacion.cabecera.no_gravado": deCabecera("No gravado", true),
  "compras.exportacion.cabecera.exento": deCabecera("Exento", true),
  "compras.exportacion.cabecera.iva": deCabecera("IVA", true),
  "compras.exportacion.cabecera.tributos": deCabecera("Tributos", true),
  "compras.exportacion.cabecera.total_calculado": deCabecera("Total calculado", true),
  "compras.exportacion.cabecera.total_segun_factura": deCabecera("Total según factura", true),
  "compras.exportacion.cabecera.importe_de_las_lineas": deCabecera("Importe de las líneas", true),
  "compras.exportacion.cabecera.cantidad_de_renglones": deCabecera("Cantidad de renglones", false),
  "compras.exportacion.cabecera.estado_del_pago": deCabecera("Estado del pago", true),
  "compras.exportacion.cabecera.importe_abonado": deCabecera("Importe abonado", true),
  "compras.exportacion.cabecera.saldo": deCabecera("Saldo", true),
  "compras.exportacion.cabecera.fecha_de_pago": deCabecera("Fecha de pago", true),
  "compras.exportacion.cabecera.medio_de_pago": deCabecera("Medio de pago", true),
  "compras.exportacion.cabecera.estado_de_la_factura": deCabecera("Estado de la factura", true),
  "compras.exportacion.cabecera.registrado_el": deCabecera("Registrado el", false),
  "compras.exportacion.cabecera.registrado_por": deCabecera("Registrado por", false),
  "compras.exportacion.cabecera.signo": deCabecera("Signo", true),
  // Detalle (una fila por línea)
  "compras.exportacion.detalle.linea": deDetalle("Línea", false),
  "compras.exportacion.detalle.codigo_del_producto": deDetalle("Código del producto", false),
  "compras.exportacion.detalle.clasificacion": deDetalle("Clasificación", false),
  "compras.exportacion.detalle.presentacion": deDetalle("Presentación", false),
  "compras.exportacion.detalle.cantidad_de_la_presentacion": deDetalle(
    "Cantidad de la presentación",
    false,
  ),
  "compras.exportacion.detalle.cantidad_de_compra": deDetalle("Cantidad de compra", false),
  "compras.exportacion.detalle.unidad_de_compra": deDetalle("Unidad de compra", false),
  "compras.exportacion.detalle.peso_real": deDetalle("Peso real", false),
  "compras.exportacion.detalle.cantidad_en_stock": deDetalle("Cantidad en stock", false),
  "compras.exportacion.detalle.unidad_de_stock": deDetalle("Unidad de stock", false),
  "compras.exportacion.detalle.precio": deDetalle("Precio", true),
  "compras.exportacion.detalle.precio_por": deDetalle("Precio por", true),
  "compras.exportacion.detalle.unidad_de_precio": deDetalle("Unidad de precio", true),
  "compras.exportacion.detalle.importe_vigente": deDetalle("Importe vigente", true),
  "compras.exportacion.detalle.costo_por_unidad_de_stock": deDetalle(
    "Costo por unidad de stock",
    true,
  ),
  "compras.exportacion.detalle.estado_del_pago_de_la_factura": deDetalle(
    "Estado del pago de la factura",
    true,
  ),
  "compras.exportacion.detalle.importe_abonado_derivado": deDetalle(
    "Importe abonado (derivado)",
    true,
  ),
  "compras.exportacion.detalle.costo_por_kilo_derivado": deDetalle(
    "Costo por kilo (derivado)",
    true,
  ),
  // Resumen (una fila por sucursal × producto × unidad de compra)
  "compras.exportacion.resumen.compras": deResumen("Compras", false),
  "compras.exportacion.resumen.renglones": deResumen("Renglones", false),
  "compras.exportacion.resumen.renglones_sin_precio": deResumen("Renglones sin precio", true),
  // Valores de celda
  "compras.exportacion.valor.compra_vigente": deValor("Confirmada", false),
  "compras.exportacion.valor.pagado": deValor("Pagado", true),
  "compras.exportacion.valor.registrado": deValor("Registrado", true),
} as const;
