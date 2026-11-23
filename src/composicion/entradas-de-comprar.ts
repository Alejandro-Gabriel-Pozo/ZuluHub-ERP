import { z } from "zod";
import { ok, type Resultado } from "../primitivas/resultado/resultado";
import { textoDeBusquedaDeProductoDesdeTexto } from "../primitivas/texto/termino-de-busqueda-de-producto";
import { leer, texto, type ErrorDeEntrada } from "./entradas-de-facturacion";

/**
 * La frontera de «productos para comprar» (compras, PR 5): de lo que pide la pantalla a lo que acepta la consulta. Pura: sin base ni servidor. Solo se toma `texto`; la empresa, la persona, el
 * tope y el orden los pone el servidor. El texto pasa por la lista de permitidos de la búsqueda de productos (la misma del catálogo: ningún nombre tiene lo que ella rechaza); vacío es
 * «sin filtro». Un texto que ella rechaza NO ensancha la búsqueda: es «nada puede coincidir» (`ninguno: true`), la misma regla que la lista de productos.
 * Previene: un filtro libre que llega sin validar a la consulta, y un filtro inválido que se ignora y muestra todo. Chequeo: `entradas-de-comprar.test.ts`.
 */

const forma = z.object({ texto: texto.optional() });

export type EntradaWebDeProductosParaComprar =
  Readonly<{ ninguno: true }> | Readonly<{ ninguno: false; texto: string | undefined }>;

export function entradaDeProductosParaComprar(
  crudo: unknown,
): Resultado<EntradaWebDeProductosParaComprar, ErrorDeEntrada> {
  const leida = leer(forma, crudo ?? {});
  if (!leida.ok) return leida;
  const busqueda = textoDeBusquedaDeProductoDesdeTexto(leida.valor.texto ?? "");
  if (!busqueda.ok) return ok({ ninguno: true });
  return ok({ ninguno: false, texto: busqueda.valor ?? undefined });
}
