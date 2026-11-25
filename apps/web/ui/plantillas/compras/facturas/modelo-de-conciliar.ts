import { sinCerosDeRelleno } from "../nueva/modelo-de-factura";
import {
  cantidadConUnidad,
  nombreDeLaSucursal,
  type SucursalConNombre,
} from "./modelo-de-facturas";

/**
 * El modelo de «Conciliar» (Compras 4; maqueta `compra-conciliar.html`): qué se reparte entre la factura y lo recibido por sucursal y el pedido que sale. Puro: sin React ni servidor. NO calcula saldos ni topes
 * (lo recibido, lo facturado y lo ya conciliado los dice el servidor; que no se pase de lo recibido ni de lo facturado lo impone el servidor y la base): arma el pedido de lo que la persona dejó escrito y
 * muestra lo que devuelve el servidor. La propuesta de un toque es la que armó el servidor (`proponerConciliacion`, limitada al alcance de quien pide): la persona la deja o la corrige.
 */

export type DatosParaConciliarParaLaPantalla = Readonly<{
  lineas: readonly Readonly<{
    numero: number;
    producto: string | null;
    unidadDeStockId: string | null;
    facturada: string;
    sinConciliar: string;
  }>[];
  recibidas: readonly Readonly<{
    recepcionId: string;
    recepcionNumero: number;
    sucursalId: string;
    linea: number;
    productoId: string;
    producto: string | null;
    unidadDeStockId: string | null;
    recibida: string;
    sinAsignar: string;
  }>[];
  propuesta: readonly Readonly<{
    lineaDeFactura: number;
    recepcionId: string;
    lineaDeRecepcion: number;
    cantidad: string;
  }>[];
  productosDeLasLineas: readonly Readonly<{ numero: number; productoId: string }>[];
}>;

/** Lo escrito por par (línea de la factura, línea recibida): texto decimal canónico o `""`. */
export type Reparto = Readonly<Record<string, string>>;

const claveDelPar = (lineaDeFactura: number, recepcionId: string, lineaDeRecepcion: number) =>
  `${String(lineaDeFactura)}|${recepcionId}|${String(lineaDeRecepcion)}`;

/** El reparto que arranca cargado: la propuesta del servidor, sin los ceros de relleno («1000.0000» se ve «1.000»): el mismo valor canónico. */
export const repartoInicial = (datos: DatosParaConciliarParaLaPantalla): Reparto =>
  Object.fromEntries(
    datos.propuesta.map((a) => [
      claveDelPar(a.lineaDeFactura, a.recepcionId, a.lineaDeRecepcion),
      sinCerosDeRelleno(a.cantidad),
    ]),
  );

export type PedidoDeConciliar = Readonly<{
  comprobanteId: string;
  asignaciones: readonly Readonly<{
    lineaDeFactura: number;
    recepcionId: string;
    lineaDeRecepcion: number;
    cantidad: string;
  }>[];
}>;

/**
 * El pedido que sale al confirmar: un renglón por cada par con cantidad escrita (el vacío es «nada para esa línea recibida»); el orden es el de la pantalla. Lo que el servidor rechace (cero, más de lo
 * recibido o de lo facturado) vuelve como el genérico: la pantalla no lo adivina.
 */
export function armarElPedidoDeConciliar(
  comprobanteId: string,
  datos: DatosParaConciliarParaLaPantalla,
  reparto: Reparto,
): PedidoDeConciliar {
  const asignaciones: PedidoDeConciliar["asignaciones"][number][] = [];
  for (const linea of datos.lineas) {
    for (const r of recibidasDe(datos, linea.numero)) {
      const cantidad = reparto[claveDelPar(linea.numero, r.recepcionId, r.linea)] ?? "";
      if (cantidad === "") continue;
      asignaciones.push({
        lineaDeFactura: linea.numero,
        recepcionId: r.recepcionId,
        lineaDeRecepcion: r.linea,
        cantidad,
      });
    }
  }
  return { comprobanteId, asignaciones };
}

/** Las líneas recibidas del mismo producto que la línea de la factura (con las que se puede repartir). */
function recibidasDe(datos: DatosParaConciliarParaLaPantalla, lineaDeFactura: number) {
  const productoId = datos.productosDeLasLineas.find(
    (p) => p.numero === lineaDeFactura,
  )?.productoId;
  return datos.recibidas.filter((r) => r.productoId === productoId);
}

export type LineaDeConciliarArmada = Readonly<{
  numero: number;
  nombre: string;
  facturado: string;
  /** Una por cada línea recibida del mismo producto, de las sucursales del alcance. */
  candidatas: readonly Readonly<{
    clave: string;
    lineaDeFactura: number;
    recepcionId: string;
    lineaDeRecepcion: number;
    /** «Sucursal Centro · Recepción 14». */
    rotulo: string;
    /** «Recibido: 40 kg» (lo que todavía no se asignó a ninguna factura). */
    recibido: string;
  }>[];
}>;

export function armarLasLineasDeConciliar(
  datos: DatosParaConciliarParaLaPantalla,
  sucursales: readonly SucursalConNombre[],
  textos: Readonly<{ recepcion: string; recibido: string; facturado: string }>,
): readonly LineaDeConciliarArmada[] {
  return datos.lineas.map((l) => ({
    numero: l.numero,
    nombre: l.producto ?? "—",
    facturado: `${textos.facturado}: ${cantidadConUnidad(l.sinConciliar, l.unidadDeStockId)}`,
    candidatas: recibidasDe(datos, l.numero).map((r) => ({
      clave: claveDelPar(l.numero, r.recepcionId, r.linea),
      lineaDeFactura: l.numero,
      recepcionId: r.recepcionId,
      lineaDeRecepcion: r.linea,
      rotulo: `${nombreDeLaSucursal(sucursales, r.sucursalId)} · ${textos.recepcion} ${String(r.recepcionNumero)}`,
      recibido: `${textos.recibido}: ${cantidadConUnidad(r.sinAsignar, r.unidadDeStockId)}`,
    })),
  }));
}
