import { importeCero, sumar, type Importe } from "../../../primitivas/dinero/importe";
import type { Moneda } from "../../../primitivas/dinero/moneda";
import { exactoDeImporte } from "../../../primitivas/dinero/monto-exacto";
import { prorratear } from "../../../primitivas/dinero/prorrateo";
import type { Politica } from "../../../primitivas/dinero/redondeo";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import {
  calcularComprobante,
  type ComprobanteCalculado,
  type LineaDeComprobante,
} from "./comprobante";
import type { EmisorId, PuntoDeVentaId } from "./identificadores";

/**
 * Renglones a facturar → 1..N comprobantes (spec H7 §B.7, nivel 4): quien factura da los renglones y
 * se genera UN comprobante por emisor distinto, cada uno con su punto de venta. El redondeo se hace
 * una vez POR COMPROBANTE (ADR-006); el total es la suma de sus totales y un cobro se puede repartir
 * entre ellos con `prorratear` (pesos = totales). Todo puro: el orden de los planes es determinista.
 */
export type LineaAFacturar = Readonly<{ posicion: number; emisorId: EmisorId }>;

export type PuntoDeVentaDeSucursal = Readonly<{ id: PuntoDeVentaId; emisorId: EmisorId }>;

export type PlanDeComprobante = Readonly<{
  emisorId: EmisorId;
  puntoDeVentaId: PuntoDeVentaId;
  /** Las posiciones de las líneas del comprobante, de menor a mayor. */
  posiciones: readonly number[];
}>;

export type ErrorDePlan =
  | "PUNTO_DE_VENTA_ELEGIDO_NO_HABILITADO"
  | "SIN_PUNTO_DE_VENTA_PARA_EMISOR"
  | "PUNTO_DE_VENTA_AMBIGUO";

/**
 * Agrupa las líneas por emisor y asigna el punto de venta de cada grupo: el elegido, si es de ese
 * emisor; si no, el único habilitado del emisor en la sucursal. `habilitados` son los puntos de
 * venta habilitados de la sucursal donde se factura.
 *
 * Orden de los errores: un punto de venta elegido que no está habilitado
 * (`PUNTO_DE_VENTA_ELEGIDO_NO_HABILITADO`, no se cambia en silencio por otro), y por cada plan, en
 * orden, `SIN_PUNTO_DE_VENTA_PARA_EMISOR` o `PUNTO_DE_VENTA_AMBIGUO` (varios y ninguno elegido).
 * Los planes salen ordenados por la primera posición de cada uno. Repetir una posición es un error
 * de programación y lanza.
 */
export function planificarComprobantes(
  lineas: readonly LineaAFacturar[],
  habilitados: readonly PuntoDeVentaDeSucursal[],
  elegido: PuntoDeVentaId | null,
): Resultado<readonly PlanDeComprobante[], ErrorDePlan> {
  if (new Set(lineas.map((l) => l.posicion)).size !== lineas.length) {
    throw new RangeError("hay posiciones de línea repetidas");
  }
  const puntoElegido = elegido === null ? null : habilitados.find((p) => p.id === elegido);
  if (puntoElegido === undefined) return err("PUNTO_DE_VENTA_ELEGIDO_NO_HABILITADO");

  const porEmisor = new Map<EmisorId, number[]>();
  for (const { posicion, emisorId } of lineas) {
    const posiciones = porEmisor.get(emisorId);
    if (posiciones === undefined) porEmisor.set(emisorId, [posicion]);
    else posiciones.push(posicion);
  }
  const grupos = [...porEmisor.entries()]
    .map(([emisorId, posiciones]) => ({ emisorId, posiciones: posiciones.sort((a, b) => a - b) }))
    .sort((a, b) => (a.posiciones[0] ?? 0) - (b.posiciones[0] ?? 0));

  const planes: PlanDeComprobante[] = [];
  for (const { emisorId, posiciones } of grupos) {
    let puntoDeVentaId: PuntoDeVentaId;
    if (puntoElegido !== null && puntoElegido.emisorId === emisorId) {
      puntoDeVentaId = puntoElegido.id;
    } else {
      const delEmisor = [
        ...new Set(habilitados.filter((p) => p.emisorId === emisorId).map((p) => p.id)),
      ];
      const [unico, ...otros] = delEmisor;
      if (unico === undefined) return err("SIN_PUNTO_DE_VENTA_PARA_EMISOR");
      if (otros.length > 0) return err("PUNTO_DE_VENTA_AMBIGUO");
      puntoDeVentaId = unico;
    }
    planes.push({ emisorId, puntoDeVentaId, posiciones });
  }
  return ok(planes);
}

export type LineaAFacturarCalculable = LineaAFacturar & Readonly<{ linea: LineaDeComprobante }>;

export type ComprobanteDeVentaCalculado = Readonly<{
  plan: PlanDeComprobante;
  calculado: ComprobanteCalculado;
}>;

/**
 * Calcula cada comprobante del plan con `calcularComprobante` (redondeo una vez por comprobante).
 * Las líneas del plan tienen que estar en `lineas`; si falta alguna es un error de programación.
 */
export function calcularComprobantesDeVenta(
  moneda: Moneda,
  lineas: readonly LineaAFacturarCalculable[],
  planes: readonly PlanDeComprobante[],
  politica: Politica,
): readonly ComprobanteDeVentaCalculado[] {
  const porPosicion = new Map(lineas.map((l) => [l.posicion, l.linea]));
  return planes.map((plan) => {
    const delPlan = plan.posiciones.map((posicion) => {
      const linea = porPosicion.get(posicion);
      if (linea === undefined) throw new RangeError(`falta la línea de la posición ${posicion}`);
      return linea;
    });
    return { plan, calculado: calcularComprobante(moneda, delPlan, politica) };
  });
}

/** El total de lo facturado: la suma de los totales de sus comprobantes (cada uno redondeado por separado). */
export function totalDeLaVenta(
  moneda: Moneda,
  comprobantes: readonly ComprobanteDeVentaCalculado[],
): Importe {
  return comprobantes.reduce((suma, c) => sumar(suma, c.calculado.total), importeCero(moneda));
}

/**
 * Reparte el cobro único entre los comprobantes, en proporción a sus totales (restos mayores,
 * ADR-006): las partes suman exactamente el cobro. Un total que no se puede repartir (todos en cero
 * y un cobro distinto de cero) lo rechaza `prorratear`.
 */
export function repartirCobro(cobro: Importe, totales: readonly Importe[]): Importe[] {
  return prorratear(cobro, totales.map(exactoDeImporte));
}
