import type { Cantidad } from "../../../primitivas/cantidad/cantidad";
import type { Porcentaje } from "../../../primitivas/cantidad/porcentaje";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { convertirCantidad } from "../../../primitivas/unidades/convertir-cantidad";
import { UNIDADES, type CodigoDeUnidad } from "../../../primitivas/unidades/unidades";

/**
 * La validación de una composición (receta simple de un producto vendible, E5 §3.2 `guardarComposicion` y §3.1): lo que se puede decir
 * ANTES de leer la base. Sin ciclos: no aplica (E5 no tiene subcomposiciones; lo suma E6). Que el artículo exista y esté controlado, y
 * que el producto sea `VENDIBLE`, lo comprueba el caso de uso. Puro.
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
        | "FUERA_DE_RANGO";
    }>
  | Readonly<{ codigo: "FUNCION_NO_INCLUIDA"; perilla: PerillaDeComposicion }>;

/** Lo que dicen las perillas de la empresa (`exigirPerilla`): pérdida y compuestos existen en la base pero solo se guardan con ellas. */
export type PerillasDeComposicion = Readonly<Record<PerillaDeComposicion, boolean>>;

export type ComponenteAValidar = Readonly<{
  articuloId: string;
  cantidad: Cantidad;
  unidadId: string;
  /** La unidad de stock del artículo (es la base de su producto). */
  unidadDeStockId: string;
  perdida: Porcentaje | null;
  compuestoId: string | null;
}>;

export type ComponenteValido = Readonly<{
  articuloId: string;
  cantidad: Cantidad;
  unidadId: CodigoDeUnidad;
}>;

export type ComposicionValida = Readonly<{
  rinde: Cantidad;
  componentes: readonly ComponenteValido[];
}>;

/** Un código de unidad conocido (de la lista cerrada de `primitivas/unidades`): la puerta para llevar un texto de la base a `CodigoDeUnidad`. */
export const esUnidadConocida = (texto: string): texto is CodigoDeUnidad =>
  Object.hasOwn(UNIDADES, texto);

/**
 * Valida el conjunto final de una composición: no vacía; `rinde > 0`; sin componentes repetidos (un artículo una sola vez); cada
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
  if (new Set(componentes.map((c) => c.articuloId)).size !== componentes.length) {
    return err({ codigo: "COMPONENTE_REPETIDO" });
  }
  const validos: ComponenteValido[] = [];
  for (const c of componentes) {
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
    validos.push({ articuloId: c.articuloId, cantidad: c.cantidad, unidadId: c.unidadId });
  }
  return ok({ rinde, componentes: validos });
}
