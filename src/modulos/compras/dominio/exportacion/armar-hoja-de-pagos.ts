import { MONEDA, datosDelComprobante } from "./armar-hojas";
import {
  celdaDeFecha,
  celdaDeTexto,
  celdaDecimal,
  celdaEntera,
  type Celda,
  type HojaDeExportacion,
} from "./celdas";
import type { CompraParaExportar, RotulosDeExportacion } from "./datos";

/**
 * La hoja de Pagos, en formato LARGO para tablas dinámicas: una fila por LÍNEA de medio de cada pago vigente (el id del pago se repite), con el importe de esa línea y las dimensiones (compra, comprobante,
 * proveedor, sucursal y fecha de pago) en cada fila; sin celdas combinadas ni medios concatenados. Un pago de un solo medio es una fila.
 */
export const COLUMNAS_DE_PAGOS = [
  "id_del_pago",
  "id",
  "numero",
  "sucursal",
  "proveedor",
  "tipo",
  "letra",
  "punto_de_venta",
  "numero_del_comprobante",
  "fecha_del_comprobante",
  "fecha_de_pago",
  "medio_de_pago",
  "importe_del_medio",
  "moneda",
] as const;
export type ColumnaDePagos = (typeof COLUMNAS_DE_PAGOS)[number];

/**
 * Los pagos VIGENTES de las compras de la Cabecera, una fila por línea de medio (un pago anulado no suma: un pivot por medio contaría la plata dos veces). El medio de cada línea es el de la lista; si un pago no trae
 * líneas (no pasa desde el relleno de la 0103, pero la hoja no se inventa nada) sale una fila con el medio y el importe de su cabecera.
 */
export function armarPagos(
  compras: readonly CompraParaExportar[],
  r: RotulosDeExportacion,
): HojaDeExportacion<ColumnaDePagos> {
  const filas: Celda[][] = [];
  for (const c of compras) {
    const f = c.comprobante;
    if (!c.enCabecera || f === null) continue;
    const d = datosDelComprobante(f, r);
    for (const pago of f.pagos) {
      if (pago.estado !== "VIGENTE") continue;
      const lineas =
        pago.medios.length > 0 ? pago.medios : [{ medio: pago.medio, importe: pago.importe }];
      for (const linea of lineas) {
        filas.push([
          celdaDeTexto(pago.id),
          celdaDeTexto(c.recepcionId),
          celdaEntera(c.numero),
          celdaDeTexto(c.sucursalNombre),
          celdaDeTexto(c.proveedorNombre),
          d.tipo,
          d.letra,
          d.puntoDeVenta,
          d.numero,
          d.fecha,
          celdaDeFecha(pago.fechaDePago),
          celdaDeTexto(r.medioDePago(linea.medio)),
          celdaDecimal(linea.importe, 2),
          celdaDeTexto(MONEDA),
        ]);
      }
    }
  }
  return { columnas: COLUMNAS_DE_PAGOS, filas };
}
