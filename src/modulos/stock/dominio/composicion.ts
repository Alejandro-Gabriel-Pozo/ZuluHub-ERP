import type { Cantidad } from "../../../primitivas/cantidad/cantidad";
import { porcentajeDesdeTexto, type Porcentaje } from "../../../primitivas/cantidad/porcentaje";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { convertirCantidad } from "../../../primitivas/unidades/convertir-cantidad";
import { UNIDADES, type CodigoDeUnidad } from "../../../primitivas/unidades/unidades";

/**
 * La validación de una composición (receta de un producto vendible o elaborado, E5 §3.2 `guardarComposicion` y E6 §3.2): lo que se puede
 * decir ANTES de leer la base. Un componente es un artículo de stock O un producto elaborado (`compuestoId`, D96). Los ciclos y los niveles
 * son de `subcomposicion.ts`. Que el artículo exista y esté controlado, y que el producto lleve receta, lo comprueba el caso de uso. Puro.
 */
export type PerillaDeComposicion = "composiciones_con_perdida" | "subcomposiciones";

export type ErrorDeComposicion =
  | Readonly<{
      codigo:
        | "COMPOSICION_VACIA"
        | "RINDE_INVALIDO"
        | "COMPONENTE_REPETIDO"
        | "CANTIDAD_INVALIDA"
        | "UNIDAD_INVALIDA"
        | "DIMENSION_DISTINTA"
        | "CONVERSION_NO_EXACTA"
        | "PERDIDA_INVALIDA"
        | "FUERA_DE_RANGO";
    }>
  | Readonly<{ codigo: "FUNCION_NO_INCLUIDA"; perilla: PerillaDeComposicion }>;

/** Lo que dicen las perillas de la empresa (`exigirPerilla`): pérdida y compuestos existen en la base pero solo se guardan con ellas. */
export type PerillasDeComposicion = Readonly<Record<PerillaDeComposicion, boolean>>;

export type ComponenteAValidar = Readonly<{
  /** El artículo de stock del componente; `null` si es un elaborado (entonces va `compuestoId`). Exactamente uno de los dos. */
  articuloId: string | null;
  cantidad: Cantidad;
  unidadId: string;
  /** La unidad de stock del artículo, o la unidad base del producto elaborado: la de la dimensión del componente. */
  unidadDeStockId: string;
  perdida: Porcentaje | null;
  /** El producto `ELABORADO` del componente; `null` si es un artículo. */
  compuestoId: string | null;
}>;

export type ComponenteValido = Readonly<{
  articuloId: string | null;
  compuestoId: string | null;
  cantidad: Cantidad;
  unidadId: CodigoDeUnidad;
  perdida: Porcentaje | null;
}>;

/** La pérdida es un porcentaje de 0 a menos de 100 (la base: `componente_perdida_ck`; un `Porcentaje` ya no es negativo): 100 % no dejaría nada para el plato. */
const CIEN_PUNTOS = porcentajeDesdeTexto("100").unidades;

export type ComposicionValida = Readonly<{
  rinde: Cantidad;
  componentes: readonly ComponenteValido[];
}>;

/** Un código de unidad conocido (de la lista cerrada de `primitivas/unidades`): la puerta para llevar un texto de la base a `CodigoDeUnidad`. */
export const esUnidadConocida = (texto: string): texto is CodigoDeUnidad =>
  Object.hasOwn(UNIDADES, texto);

/**
 * Valida el conjunto final de una composición: no vacía; `rinde > 0`; sin componentes repetidos (un artículo o un elaborado una sola vez); cada
 * componente con cantidad `> 0`, unidad conocida de la MISMA dimensión que la unidad de stock de su artículo, y llevable a ella en forma
 * exacta (una conversión que no es exacta frenaría después la venta en la explosión, con la cuenta ya cobrada); pérdida y compuesto solo
 * con su perilla. Devuelve el primer error en ese orden.
 */
export function validarComposicion(
  rinde: Cantidad,
  componentes: readonly ComponenteAValidar[],
  perillas: PerillasDeComposicion,
): Resultado<ComposicionValida, ErrorDeComposicion> {
  if (componentes.length === 0) return err({ codigo: "COMPOSICION_VACIA" });
  if (rinde.unidades <= 0n) return err({ codigo: "RINDE_INVALIDO" });
  for (const c of componentes) {
    if ((c.articuloId === null) === (c.compuestoId === null)) {
      throw new RangeError("un componente es un artículo o un elaborado, no los dos ni ninguno");
    }
  }
  if (new Set(componentes.map((c) => c.articuloId ?? c.compuestoId)).size !== componentes.length) {
    return err({ codigo: "COMPONENTE_REPETIDO" });
  }
  const validos: ComponenteValido[] = [];
  for (const c of componentes) {
    if (c.perdida !== null && c.perdida.unidades >= CIEN_PUNTOS) {
      return err({ codigo: "PERDIDA_INVALIDA" });
    }
    if (c.perdida !== null && c.perdida.unidades !== 0n && !perillas.composiciones_con_perdida) {
      return err({ codigo: "FUNCION_NO_INCLUIDA", perilla: "composiciones_con_perdida" });
    }
    if (c.compuestoId !== null && !perillas.subcomposiciones) {
      return err({ codigo: "FUNCION_NO_INCLUIDA", perilla: "subcomposiciones" });
    }
    if (!esUnidadConocida(c.unidadId) || !esUnidadConocida(c.unidadDeStockId)) {
      return err({ codigo: "UNIDAD_INVALIDA" });
    }
    if (c.cantidad.unidades <= 0n) return err({ codigo: "CANTIDAD_INVALIDA" });
    const enStock = convertirCantidad(c.cantidad, c.unidadId, c.unidadDeStockId);
    if (!enStock.ok) return err({ codigo: enStock.error });
    validos.push({
      articuloId: c.articuloId,
      compuestoId: c.compuestoId,
      cantidad: c.cantidad,
      unidadId: c.unidadId,
      perdida: c.perdida !== null && c.perdida.unidades !== 0n ? c.perdida : null,
    });
  }
  return ok({ rinde, componentes: validos });
}
