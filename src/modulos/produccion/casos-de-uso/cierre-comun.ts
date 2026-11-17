import { cantidadConSignoDesdeTexto } from "../../../primitivas/cantidad/con-signo";
import { formatearDecimalFijo } from "../../../primitivas/cantidad/decimal-fijo";
import { mermaDeLote } from "../dominio/esperados";
import type { OrdenGuardada } from "../persistencia/modelo";

export type ConsumoRealDeEntrada = Readonly<{
  productoId: string;
  /** Texto decimal exacto, de cero en adelante (cero: no se usó), en `unidadId`. */
  cantidadReal: string;
  unidadId: string;
}>;

export type EntradaDeCerrarOrden = Readonly<{
  ordenId: string;
  /** La clave de la pantalla (UUID, D136): con la misma huella es el mismo cierre. */
  clave: string;
  /** Lo que realmente se obtuvo (texto decimal exacto, mayor que cero), en `unidadId`. */
  obtenido: string;
  unidadId: string;
  /** El vencimiento del lote del producto (`AAAA-MM-DD`); lo exige un artículo con control `LOTE_Y_VENCIMIENTO`. */
  vence?: string | null | undefined;
  /** Lo real de cada ingrediente de la orden (los que no vienen valen cero). */
  consumos: readonly ConsumoRealDeEntrada[];
  confirmaciones?: readonly string[] | undefined;
}>;

export type SalidaDeCerrarOrden = Readonly<{
  /** El código del lote del producto (`OP-<número>`), o `null` si el artículo no lleva control de lote. */
  lote: string | null;
  /** Costo congelado por unidad (6 decimales), o `null` si algún ingrediente no tenía costo. */
  costoUnitario: string | null;
  costoEstado: "SIN_COSTO" | "DEFINITIVO";
  /** `esperado − obtenido`, texto decimal (negativo si se obtuvo de más). */
  mermaDeLote: string;
  /** Los ingredientes que quedaron en negativo porque el control lo permitió (cada uno auditado en el libro). */
  excepciones: readonly Readonly<{ productoId: string; existenciaResultante: string }>[];
  yaExistia: boolean;
}>;

/** Auxiliares del cierre de una orden (cuentas de cantidades y la salida), aparte para que `cerrar-orden.ts` quede bajo el tope de líneas. */

/** El código del lote que fabrica una orden (la identidad del lote es el código: una orden, un lote). */
export const codigoDeLoteDeOrden = (numero: number): string => `OP-${numero}`;

export function mermaYSalida(
  orden: OrdenGuardada,
  lote: string | null,
  excepciones: SalidaDeCerrarOrden["excepciones"],
  yaExistia: boolean,
): SalidaDeCerrarOrden {
  const esperado = cantidadConSignoDesdeTexto(orden.cantidadEsperada);
  const obtenido = cantidadConSignoDesdeTexto(orden.cantidadObtenida ?? "0");
  if (!esperado.ok || !obtenido.ok)
    throw new RangeError("producción: cantidad de la orden inválida");
  return {
    lote,
    costoUnitario: orden.costoUnitario,
    costoEstado: orden.costoEstado ?? "SIN_COSTO",
    mermaDeLote: formatearDecimalFijo(
      mermaDeLote(esperado.valor.unidades, obtenido.valor.unidades),
      4,
    ),
    excepciones,
    yaExistia,
  };
}

/** Una cantidad con signo positiva (la entrada suma) desde unidades mínimas. */
export function positiva(unidades: bigint) {
  const c = cantidadConSignoDesdeTexto(formatearDecimalFijo(unidades, 4));
  if (!c.ok) throw new RangeError("producción: cantidad del producto inválida");
  return c.valor;
}

/** Una cantidad con signo (la salida resta) desde unidades mínimas: por el texto, que es como la entiende la primitiva. */
export function negada(unidades: bigint) {
  const c = cantidadConSignoDesdeTexto(`-${formatearDecimalFijo(unidades, 4)}`);
  if (!c.ok) throw new RangeError("producción: cantidad de consumo inválida");
  return c.valor;
}
