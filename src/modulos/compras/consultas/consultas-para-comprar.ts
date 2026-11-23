import {
  productosParaComprarDentro,
  type EntradaDeProductosParaComprar,
  type ProductoParaComprar,
} from "../casos-de-uso/lectura-para-comprar";
import { type Lector, type RDeConsulta } from "./comun";

export type { EntradaDeProductosParaComprar, ProductoParaComprar };

export function armarConsultasParaComprar(leer: Lector) {
  return {
    /**
     * Los productos que se pueden comprar (materia prima, insumo y reventa activos) con su unidad base y sus presentaciones activas, por nombre, hasta un tope fijo. Acción
     * `recepciones.ver`: mirar es de los tres roles; el que además registra compras lo decide `recepciones.registrar` al guardar, no esta lectura.
     */
    productosParaComprar(
      contexto: Parameters<Lector>[0],
      entrada: EntradaDeProductosParaComprar = {},
    ): Promise<RDeConsulta<readonly ProductoParaComprar[]>> {
      return leer(contexto, ["recepciones.ver"], (tx) =>
        productosParaComprarDentro(tx, contexto, entrada),
      );
    },
  };
}
