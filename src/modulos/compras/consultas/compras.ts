import {
  comprasSinPrecioDentro,
  fichaDeCompraDentro,
  listarComprasDentro,
  type EntradaDeListarCompras,
} from "../casos-de-uso/lectura";
import { type Lector, type RDeConsulta } from "./comun";
import type { PaginaDeCompras, CompraDeLista, FichaDeCompra } from "../casos-de-uso/lectura";

export type { EntradaDeListarCompras, PaginaDeCompras, CompraDeLista, FichaDeCompra };

export function armarConsultasDeCompras(leer: Lector) {
  return {
    /** Las compras de la empresa y del alcance de quien pide, de la más nueva a la más vieja, con su estado derivado, paginadas por cursor. */
    async listarCompras(
      contexto: Parameters<Lector>[0],
      entrada: EntradaDeListarCompras = {},
    ): Promise<RDeConsulta<PaginaDeCompras>> {
      const r = await leer(contexto, ["recepciones.ver"], (tx) =>
        listarComprasDentro(tx, contexto, entrada),
      );
      return r.ok ? r.valor : r;
    },
    /** La ficha de una compra con sus líneas; `null` si no existe o es de otra sucursal u otra empresa (indistinguible). */
    async fichaDeCompra(
      contexto: Parameters<Lector>[0],
      entrada: Readonly<{ recepcionId: string }>,
    ): Promise<RDeConsulta<FichaDeCompra | null>> {
      const r = await leer(contexto, ["recepciones.ver"], (tx) =>
        fichaDeCompraDentro(tx, contexto, entrada),
      );
      return r.ok ? r.valor : r;
    },
    /** Lo que falta completar: las compras con alguna línea «Sin precio». */
    comprasSinPrecio(
      contexto: Parameters<Lector>[0],
    ): Promise<RDeConsulta<readonly CompraDeLista[]>> {
      return leer(contexto, ["recepciones.ver"], (tx) => comprasSinPrecioDentro(tx, contexto));
    },
  };
}
