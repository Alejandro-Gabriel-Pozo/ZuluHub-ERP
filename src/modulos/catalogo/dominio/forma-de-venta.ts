import { cantidadDesdeTexto, type Cantidad } from "../../../primitivas/cantidad/cantidad";
import { ErrorDeValor } from "../../../primitivas/cantidad/errores";
import type { PrecioUnitario } from "../../../primitivas/dinero/precio-unitario";
import { precioPorFactor } from "../../../primitivas/dinero/precio-de-venta";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { convertirCantidad } from "../../../primitivas/unidades/convertir-cantidad";
import { UNIDADES, type CodigoDeUnidad } from "../../../primitivas/unidades/unidades";

/**
 * La FORMA DE VENTA de un producto (decisiones 162, 166 y 169; E2 mínimo §3.8): la unidad en que se vende (de la misma dimensión que su
 * unidad base) y el paso mínimo (decimal exacto: 1, 0,5, 0,25…). El precio está en esa unidad. Puro: sin reloj ni azar.
 */
export type FormaDeVenta = Readonly<{ unidadDeVentaId: CodigoDeUnidad; pasoMinimo: Cantidad }>;

export type ErrorDeFormaDeVenta =
  "UNIDAD_INVALIDA" | "DIMENSION_DISTINTA" | "PASO_INVALIDO" | "CONVERSION_NO_EXACTA";

export const esUnidad = (texto: string): texto is CodigoDeUnidad => Object.hasOwn(UNIDADES, texto);

/** Una cantidad de texto decimal exacto (hasta 4 decimales) o `null`; nunca lanza. */
export function leerCantidad(texto: string): Cantidad | null {
  try {
    return cantidadDesdeTexto(texto);
  } catch (error) {
    if (error instanceof ErrorDeValor) return null;
    throw error;
  }
}

/**
 * Valida una forma de venta contra la unidad base del producto: unidad conocida y de su dimensión, paso mayor que cero con hasta 4
 * decimales, y que el paso llevado a la unidad base quede exacto en 4 decimales (así toda cantidad válida convierte exacta). Es la misma
 * regla que `producto_validar` en la base (0025).
 */
export function validarFormaDeVenta(
  unidadBaseId: string,
  unidadDeVentaId: string,
  pasoMinimo: string,
): Resultado<FormaDeVenta, ErrorDeFormaDeVenta> {
  if (!esUnidad(unidadBaseId) || !esUnidad(unidadDeVentaId)) return err("UNIDAD_INVALIDA");
  if (UNIDADES[unidadBaseId].dimension !== UNIDADES[unidadDeVentaId].dimension) {
    return err("DIMENSION_DISTINTA");
  }
  const paso = leerCantidad(pasoMinimo);
  if (paso === null || paso.unidades <= 0n) return err("PASO_INVALIDO");
  const enBase = convertirCantidad(paso, unidadDeVentaId, unidadBaseId);
  if (!enBase.ok) return err("CONVERSION_NO_EXACTA");
  return ok({ unidadDeVentaId, pasoMinimo: paso });
}

/**
 * Lo que el piloto deja vender: unidad de venta = unidad base y paso 1 (decisión 162). Fracciones y peso se habilitan después ampliando
 * ESTA función (o inyectando otra en los casos de uso), sin migrar nada.
 */
export function formaDeVentaDelPiloto(unidadBaseId: string, forma: FormaDeVenta): boolean {
  return forma.unidadDeVentaId === unidadBaseId && forma.pasoMinimo.unidades === PASO_UNO.unidades;
}
const PASO_UNO = cantidadDesdeTexto("1");

/** ¿La cantidad es múltiplo del paso? Los dos con la misma escala (4 decimales). */
export const esMultiploDelPaso = (cantidad: Cantidad, paso: Cantidad): boolean =>
  paso.unidades > 0n && cantidad.unidades % paso.unidades === 0n;

/**
 * El precio por unidad `desde` expresado por unidad `hasta` (kilo → gramo): `precio × factor(hasta) / factor(desde)`, exacto en 6
 * decimales o `null` (decisión 169: entonces el producto queda en precio abierto). Misma dimensión (lo garantiza quien llama).
 */
export function precioEnOtraUnidad(
  precio: PrecioUnitario,
  desde: CodigoDeUnidad,
  hasta: CodigoDeUnidad,
): PrecioUnitario | null {
  return precioPorFactor(precio, UNIDADES[hasta].factor, UNIDADES[desde].factor);
}
