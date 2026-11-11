import type { ContextoOperativo } from "../../../contexto/contexto";
import { cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import { importeATexto, importeCero } from "../../../primitivas/dinero/importe";
import {
  exactoDeImporte,
  multiplicarPrecioPorCantidad,
  sumarExactos,
} from "../../../primitivas/dinero/monto-exacto";
import { ARS } from "../../../primitivas/dinero/moneda";
import { precioUnitarioDesdeTexto } from "../../../primitivas/dinero/precio-unitario";
import { POLITICA_VIGENTE, redondear } from "../../../primitivas/dinero/redondeo";
import { esUuid } from "../persistencia/filas";
import { type Lector, type RDeConsulta } from "./comun";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

export type EntradaDeExistenciaValorizada = Readonly<{
  /** Solo ese depósito; sin él, todos los del alcance de quien pide. */
  depositoId?: string | undefined;
}>;

/**
 * Las dos cifras juntas, nunca una sola (E5 §3.5): el valor de lo que TIENE costo y cuántos pares (depósito, artículo) tienen unidades que no
 * lo tienen (entradas sin precio). Sin la segunda, el valor parecería el de toda la existencia.
 */
export type ExistenciaValorizada = Readonly<{
  moneda: "ARS";
  /** Texto decimal con 2 decimales: la suma exacta de (costo × cantidad valorizada) de cada par, redondeada UNA vez (`MITAD_SUBE_SIMETRICA`). */
  valor: string;
  /** Pares con existencia mayor que su cantidad valorizada: lo que el valor no incluye. */
  paresConUnidadesSinCosto: number;
}>;

export type EntradaDeCostoDeRenglon = Readonly<{ movimientoId: string; numero: number }>;

/** El costo congelado de un renglón: `SIN_COSTO` es «no se sabe», no cero. El costo es por unidad de stock del artículo, en `ARS`. */
export type CostoCongeladoDeRenglon =
  | Readonly<{ estado: "SIN_COSTO" }>
  | Readonly<{ estado: "DEFINITIVO"; moneda: "ARS"; costoUnitario: string }>;

export type EntradaDeUltimoCostoDeCompra = Readonly<{ articuloId: string }>;

export type UltimoCostoDeCompra = Readonly<{
  articuloId: string;
  moneda: "ARS";
  /** Por unidad de stock del artículo, con 6 decimales. */
  costoUnitario: string;
  /** La entrada por compra de la que sale. */
  movimientoId: string;
  hechoEn: Date;
}>;

/**
 * Las consultas de costos (E5 §3.4 y §3.6, tramo TCO): todas exigen `costos.ver` (gerente y administrador; el operador no ve costos nunca) y
 * respetan el alcance de sucursales del actor. Sin pantalla aprobada todavía: devuelven datos exactos y cada pantalla decide cómo mostrarlos.
 * Un id mal formado da el resultado vacío (nada se adivina), igual que las demás consultas de stock.
 */
export function armarConsultasDeCostos(leer: Lector) {
  return {
    /** El valor de lo que tiene costo y cuántos pares tienen unidades sin costo, en un depósito o en todos los del alcance. */
    existenciaValorizada: (
      contexto: ContextoOperativo,
      entrada: EntradaDeExistenciaValorizada = {},
    ): Promise<RDeConsulta<ExistenciaValorizada>> =>
      leer(
        contexto,
        DECLARACIONES_DE_CONSULTAS.existenciaValorizada.accion,
        async (tx, alcance) => {
          const resumen = await tx.costosDeStock.valorizacion(contexto.empresaId, {
            alcance,
            depositoId: entrada.depositoId,
          });
          const total = resumen.conCosto.reduce(
            (suma, par) =>
              sumarExactos(
                suma,
                multiplicarPrecioPorCantidad(
                  ARS,
                  precioUnitarioDesdeTexto(par.costoUnitario),
                  cantidadDesdeTexto(par.cantidadValorizada),
                ),
              ),
            exactoDeImporte(importeCero(ARS)),
          );
          return {
            moneda: "ARS",
            valor: importeATexto(redondear(total, POLITICA_VIGENTE)),
            paresConUnidadesSinCosto: resumen.paresConUnidadesSinCosto,
          };
        },
      ),
    /** El costo con que quedó congelado un renglón del libro; `null` si no existe, es de un depósito ajeno o es anterior al tramo de costos. */
    costoDeRenglon: (
      contexto: ContextoOperativo,
      entrada: EntradaDeCostoDeRenglon,
    ): Promise<RDeConsulta<CostoCongeladoDeRenglon | null>> =>
      leer(contexto, DECLARACIONES_DE_CONSULTAS.costoDeRenglon.accion, async (tx, alcance) => {
        const costo = await tx.costosDeStock.costoDeRenglon(
          contexto.empresaId,
          alcance,
          entrada.movimientoId,
          entrada.numero,
        );
        if (costo === null) return null;
        return costo.estado === "DEFINITIVO" && costo.costoUnitario !== null
          ? { estado: "DEFINITIVO", moneda: "ARS", costoUnitario: costo.costoUnitario }
          : { estado: "SIN_COSTO" };
      }),
    /** El costo de la compra más reciente de un artículo (alimenta el costo de la receta, D91); `null` si nunca se compró con costo. */
    ultimoCostoDeCompra: (
      contexto: ContextoOperativo,
      entrada: EntradaDeUltimoCostoDeCompra,
    ): Promise<RDeConsulta<UltimoCostoDeCompra | null>> =>
      leer(contexto, DECLARACIONES_DE_CONSULTAS.ultimoCostoDeCompra.accion, async (tx, alcance) => {
        if (typeof entrada.articuloId !== "string" || !esUuid(entrada.articuloId)) return null;
        const compra = await tx.costosDeStock.ultimaCompraConCosto(
          contexto.empresaId,
          alcance,
          entrada.articuloId,
        );
        return compra === null
          ? null
          : {
              articuloId: entrada.articuloId,
              moneda: "ARS",
              costoUnitario: compra.costoUnitario,
              movimientoId: compra.movimientoId,
              hechoEn: compra.hechoEn,
            };
      }),
  };
}
