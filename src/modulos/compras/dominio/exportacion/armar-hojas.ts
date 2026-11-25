import { instanteIsoEnArgentina } from "../../../../primitivas/tiempo/instante-en-argentina";
import { FICHA_DE_TIPO_DE_COMPROBANTE } from "../comprobante";
import {
  leerCantidad,
  leerImporte,
  textoDeCantidad,
  textoDeImporte,
} from "../decimal";
import { totalDeCompra } from "../importe-vigente";
import {
  celdaDeFecha,
  celdaDeTexto,
  celdaDecimal,
  celdaEntera,
  type Celda,
  type HojaDeExportacion,
} from "./celdas";
import { costoPorKiloDerivado } from "./montos";
import type {
  CompraParaExportar,
  ComprobanteParaExportar,
  LineaParaExportar,
  RotulosDeExportacion,
} from "./datos";
import type { CodigoDeUnidad } from "../../../../primitivas/unidades/unidades";

/**
 * Las tres hojas del archivo de compras (Cabecera, Detalle y Resumen) a partir de lo ya leído. Puro: no lee la base, no mira el reloj y no escribe ningún texto de
 * pantalla (los rótulos y los correos los trae quien llama). Cada hoja declara sus columnas por identificador; el texto de cada encabezado sale del catálogo.
 * Reglas del dueño (25/11/2026): el dinero sale del texto exacto de la base y nunca de un `number`; «Sin precio» es una celda vacía, nunca cero; kilos y cajas no
 * se suman entre sí (el Resumen agrupa por unidad); las notas de crédito salen con sus importes tal como los imprime el comprobante y `Signo` en -1.
 */

export const COLUMNAS_DE_CABECERA = [
  "id",
  "numero",
  "estado",
  "fecha_de_negocio",
  "sucursal",
  "proveedor",
  "cuit",
  "tipo",
  "letra",
  "punto_de_venta",
  "numero_del_comprobante",
  "fecha_del_comprobante",
  "moneda",
  "neto_gravado",
  "no_gravado",
  "exento",
  "iva",
  "tributos",
  "total_calculado",
  "total_segun_factura",
  "importe_de_las_lineas",
  "cantidad_de_renglones",
  "estado_del_pago",
  "importe_abonado",
  "saldo",
  "fecha_de_pago",
  "medio_de_pago",
  "estado_de_la_factura",
  "registrado_el",
  "registrado_por",
  "signo",
] as const;
export type ColumnaDeCabecera = (typeof COLUMNAS_DE_CABECERA)[number];

export const COLUMNAS_DE_DETALLE = [
  "id",
  "numero",
  "linea",
  "estado",
  "fecha_de_negocio",
  "sucursal",
  "proveedor",
  "producto",
  "codigo_del_producto",
  "clasificacion",
  "presentacion",
  "cantidad_de_la_presentacion",
  "cantidad_de_compra",
  "unidad_de_compra",
  "peso_real",
  "cantidad_en_stock",
  "unidad_de_stock",
  "precio",
  "precio_por",
  "unidad_de_precio",
  "importe_vigente",
  "costo_por_unidad_de_stock",
  "moneda",
  "tipo",
  "letra",
  "punto_de_venta",
  "numero_del_comprobante",
  "fecha_del_comprobante",
  "estado_del_pago",
  "importe_abonado_derivado",
  "costo_por_kilo_derivado",
] as const;
export type ColumnaDeDetalle = (typeof COLUMNAS_DE_DETALLE)[number];

export const COLUMNAS_DE_RESUMEN = [
  "sucursal",
  "producto",
  "unidad_de_compra",
  "compras",
  "renglones",
  "cantidad_de_compra",
  "cantidad_en_stock",
  "unidad_de_stock",
  "importe_vigente",
  "moneda",
  "renglones_sin_precio",
  "importe_abonado_derivado",
] as const;
export type ColumnaDeResumen = (typeof COLUMNAS_DE_RESUMEN)[number];

const MONEDA = "ARS";

type EstadoDelPago = "PENDIENTE" | "PAGADO" | "ANULADO";

/** El estado y el importe del pago de una factura: hay un pago vigente = pagado; solo pagos anulados = anulado; ninguno = pendiente. El pago es uno por factura y por el total. */
function pagoDe(c: ComprobanteParaExportar): Readonly<{
  estado: EstadoDelPago;
  vigente: ComprobanteParaExportar["pagos"][number] | null;
}> {
  const vigente = c.pagos.find((p) => p.estado === "VIGENTE") ?? null;
  if (vigente !== null) return { estado: "PAGADO", vigente };
  return { estado: c.pagos.length > 0 ? "ANULADO" : "PENDIENTE", vigente: null };
}

const centavos = (texto: string): bigint => {
  const v = leerImporte(texto);
  if (v === null) throw new Error(`Un importe de la base no es un decimal de pesos: ${texto}`);
  return v;
};

const claseDe = (c: ComprobanteParaExportar) =>
  c.tipo === null ? null : FICHA_DE_TIPO_DE_COMPROBANTE[c.tipo].clase;
const letraDe = (c: ComprobanteParaExportar) =>
  c.tipo === null ? null : FICHA_DE_TIPO_DE_COMPROBANTE[c.tipo].letra;

function datosDelComprobante(
  c: ComprobanteParaExportar | null,
  r: RotulosDeExportacion,
): Readonly<{
  tipo: Celda;
  letra: Celda;
  puntoDeVenta: Celda;
  numero: Celda;
  fecha: Celda;
  estadoDelPago: Celda;
}> {
  const clase = c === null ? null : claseDe(c);
  return {
    tipo: celdaDeTexto(clase === null ? null : r.tipoDeComprobante(clase)),
    letra: celdaDeTexto(c === null ? null : letraDe(c)),
    puntoDeVenta: celdaEntera(c?.puntoDeVenta ?? null),
    numero: celdaEntera(c?.numero ?? null),
    fecha: celdaDeFecha(c?.fechaDelComprobante ?? null),
    estadoDelPago: celdaDeTexto(c === null ? null : r.estadoDelPago(pagoDe(c).estado)),
  };
}

export function armarCabecera(
  compras: readonly CompraParaExportar[],
  correos: ReadonlyMap<string, string>,
  r: RotulosDeExportacion,
): HojaDeExportacion<ColumnaDeCabecera> {
  const filas = compras
    .filter((c) => c.enCabecera)
    .map((c): Celda[] => {
      const f = c.comprobante;
      const pago = f === null ? null : pagoDe(f);
      const abonado = f === null ? null : (pago?.vigente?.importe ?? "0.00");
      const saldo =
        f === null || abonado === null
          ? null
          : textoDeImporte(centavos(f.totalSegunFactura) - centavos(abonado));
      const d = datosDelComprobante(f, r);
      const clase = f === null ? null : claseDe(f);
      return [
        celdaDeTexto(c.recepcionId),
        celdaEntera(c.numero),
        celdaDeTexto(r.estadoDeLaCompra(c.estado)),
        celdaDeFecha(c.fechaNegocio),
        celdaDeTexto(c.sucursalNombre),
        celdaDeTexto(c.proveedorNombre),
        celdaDeTexto(f?.proveedorCuit ?? null),
        d.tipo,
        d.letra,
        d.puntoDeVenta,
        d.numero,
        d.fecha,
        celdaDeTexto(MONEDA),
        celdaDecimal(f?.netoGravado ?? null, 2),
        celdaDecimal(f?.noGravado ?? null, 2),
        celdaDecimal(f?.exento ?? null, 2),
        celdaDecimal(f?.iva ?? null, 2),
        celdaDecimal(f?.tributosTotal ?? null, 2),
        celdaDecimal(f?.totalCalculado ?? null, 2),
        celdaDecimal(f?.totalSegunFactura ?? null, 2),
        celdaDecimal(totalDeCompra(c.lineas.map((l) => l.importeVigente)), 2),
        celdaEntera(c.lineas.length),
        d.estadoDelPago,
        celdaDecimal(abonado, 2),
        celdaDecimal(saldo, 2),
        celdaDeFecha(pago?.vigente?.fechaDePago ?? null),
        celdaDeTexto(pago?.vigente == null ? null : r.medioDePago(pago.vigente.medio)),
        celdaDeTexto(f === null ? null : r.estadoDeLaFactura(f.estado)),
        celdaDeTexto(instanteIsoEnArgentina(c.registradoEn)),
        celdaDeTexto(correos.get(c.registradoPor) ?? null),
        celdaEntera(clase === "NOTA_DE_CREDITO" ? -1 : 1),
      ];
    });
  return { columnas: COLUMNAS_DE_CABECERA, filas };
}

/** Los kilos de una línea no se guardan: se derivan del peso real (en la unidad de compra) o, sin peso real, de lo que entra al stock si su unidad es de masa. */
function costoPorKiloDeLinea(l: LineaParaExportar): string | null {
  const importe = l.importeVigente === null ? null : leerImporte(l.importeVigente);
  const peso = l.pesoReal === null ? null : leerCantidad(l.pesoReal);
  if (peso !== null) return costoPorKiloDerivado(importe, peso, l.unidadDeCompraId as CodigoDeUnidad);
  const enStock = leerCantidad(l.cantidadEnStock);
  return enStock === null
    ? null
    : costoPorKiloDerivado(importe, enStock, l.unidadDeStockId as CodigoDeUnidad);
}

export function armarDetalle(
  compras: readonly CompraParaExportar[],
  r: RotulosDeExportacion,
): HojaDeExportacion<ColumnaDeDetalle> {
  const filas: Celda[][] = [];
  for (const c of compras) {
    if (!c.enDetalle) continue;
    const d = datosDelComprobante(c.comprobante, r);
    for (const l of c.lineas) {
      filas.push([
        celdaDeTexto(c.recepcionId),
        celdaEntera(c.numero),
        celdaEntera(l.numero),
        celdaDeTexto(r.estadoDeLaCompra(c.estado)),
        celdaDeFecha(c.fechaNegocio),
        celdaDeTexto(c.sucursalNombre),
        celdaDeTexto(c.proveedorNombre),
        celdaDeTexto(l.productoNombre),
        celdaDeTexto(l.productoCodigo),
        celdaDeTexto(l.clasificacion),
        celdaDeTexto(l.presentacionNombre),
        celdaDecimal(l.presentacionCantidad, 4),
        celdaDecimal(l.cantidadDeCompra, 4),
        celdaDeTexto(l.unidadDeCompraSimbolo),
        celdaDecimal(l.pesoReal, 4),
        celdaDecimal(l.cantidadEnStock, 4),
        celdaDeTexto(l.unidadDeStockSimbolo),
        celdaDecimal(l.precio, 6),
        celdaDeTexto(
          l.precioPorTipo === "PRESENTACION" ? l.presentacionNombre : l.precioPorTipo === "UNIDAD" ? r.precioPorUnidad : null,
        ),
        celdaDeTexto(l.unidadDePrecioSimbolo),
        celdaDecimal(l.importeVigente, 2),
        celdaDecimal(l.costoPorUnidadDeStock, 6),
        celdaDeTexto(MONEDA),
        d.tipo,
        d.letra,
        d.puntoDeVenta,
        d.numero,
        d.fecha,
        d.estadoDelPago,
        celdaDecimal(l.importeAbonadoDerivado, 2),
        celdaDecimal(costoPorKiloDeLinea(l), 6),
      ]);
    }
  }
  return { columnas: COLUMNAS_DE_DETALLE, filas };
}

type Grupo = {
  sucursal: string;
  producto: string;
  unidadDeCompraSimbolo: string;
  unidadDeCompraId: string;
  unidadDeStockSimbolo: string;
  compras: Set<string>;
  renglones: number;
  cantidadDeCompra: bigint;
  cantidadEnStock: bigint;
  importe: bigint;
  conImporte: number;
  sinPrecio: number;
  abonado: bigint;
  conAbonado: number;
};

const porTexto = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * El Resumen: una fila por sucursal × producto × unidad de compra (la unidad forma parte de la clave para que NUNCA se sumen kilos con cajas). Sale de las mismas
 * filas del Detalle: ninguna cuenta aparte. El importe suma solo las líneas con precio y `Renglones sin precio` dice cuántas quedaron afuera (un total que calla las
 * que faltan sería menor que el real sin avisarlo).
 */
export function armarResumen(
  compras: readonly CompraParaExportar[],
): HojaDeExportacion<ColumnaDeResumen> {
  const grupos = new Map<string, Grupo>();
  for (const c of compras) {
    if (!c.enDetalle) continue;
    for (const l of c.lineas) {
      const clave = `${c.sucursalId}|${l.productoId}|${l.unidadDeCompraId}`;
      let g = grupos.get(clave);
      if (g === undefined) {
        g = {
          sucursal: c.sucursalNombre,
          producto: l.productoNombre,
          unidadDeCompraSimbolo: l.unidadDeCompraSimbolo,
          unidadDeCompraId: l.unidadDeCompraId,
          unidadDeStockSimbolo: l.unidadDeStockSimbolo,
          compras: new Set(),
          renglones: 0,
          cantidadDeCompra: 0n,
          cantidadEnStock: 0n,
          importe: 0n,
          conImporte: 0,
          sinPrecio: 0,
          abonado: 0n,
          conAbonado: 0,
        };
        grupos.set(clave, g);
      }
      g.compras.add(c.recepcionId);
      g.renglones += 1;
      g.cantidadDeCompra += leerCantidad(l.cantidadDeCompra) ?? 0n;
      g.cantidadEnStock += leerCantidad(l.cantidadEnStock) ?? 0n;
      if (l.importeVigente === null) g.sinPrecio += 1;
      else {
        g.importe += centavos(l.importeVigente);
        g.conImporte += 1;
      }
      if (l.importeAbonadoDerivado !== null) {
        g.abonado += centavos(l.importeAbonadoDerivado);
        g.conAbonado += 1;
      }
    }
  }
  const filas = [...grupos.values()]
    .sort(
      (a, b) =>
        porTexto(a.sucursal, b.sucursal) ||
        porTexto(a.producto, b.producto) ||
        porTexto(a.unidadDeCompraSimbolo, b.unidadDeCompraSimbolo),
    )
    .map((g): Celda[] => [
      celdaDeTexto(g.sucursal),
      celdaDeTexto(g.producto),
      celdaDeTexto(g.unidadDeCompraSimbolo),
      celdaEntera(g.compras.size),
      celdaEntera(g.renglones),
      celdaDecimal(textoDeCantidad(g.cantidadDeCompra), 4),
      celdaDecimal(textoDeCantidad(g.cantidadEnStock), 4),
      celdaDeTexto(g.unidadDeStockSimbolo),
      celdaDecimal(g.conImporte === 0 ? null : textoDeImporte(g.importe), 2),
      celdaDeTexto(MONEDA),
      celdaEntera(g.sinPrecio),
      celdaDecimal(g.conAbonado === 0 ? null : textoDeImporte(g.abonado), 2),
    ]);
  return { columnas: COLUMNAS_DE_RESUMEN, filas };
}
