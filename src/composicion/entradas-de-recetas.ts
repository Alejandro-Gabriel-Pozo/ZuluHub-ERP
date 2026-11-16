import type { EntradaDeIngredientes, EntradaDeListarRecetas } from "../modulos/stock/publico";
import { textoDeBusquedaDeProductoDesdeTexto } from "../primitivas/texto/termino-de-busqueda-de-producto";
import { leerLaPagina } from "./entradas-de-productos";

/**
 * Las entradas de la lista de recetas y de los ingredientes (B1 y B3 de `recetas-pantalla.md` §8): de lo que pide la dirección de la pantalla (todo texto) a lo que aceptan
 * `listarRecetas` y `ingredientesParaReceta`. Pura: sin base ni servidor. Lista de permitidos, como la de productos (misma búsqueda y misma clave de página, una regla un lugar): pasa
 * solo lo que cada filtro declara; lo que no pasa devuelve `null` («nada puede coincidir») y nunca se ensancha el filtro. Vacío es «sin filtrar» (y «primera página»).
 * Previene: un id con forma inválida que llega al `::uuid` de la consulta y un filtro libre que llega sin validar. Chequeo: `entradas-de-recetas.test.ts`.
 */

/** Lo que la dirección pide para la lista de recetas, sin validar. `conReceta`: `""`, `"con"` o `"sin"`; `activo`: `""`, `"si"` o `"no"`. */
export type EntradaDeLaListaDeRecetas = Readonly<{
  texto: string;
  conReceta: string;
  activo: string;
  despues: string;
}>;

/** Lo que la dirección pide para los ingredientes que se ofrecen, sin validar. */
export type EntradaDeLosIngredientes = Readonly<{ texto: string; despues: string }>;

const CON_RECETA = { con: true, sin: false } as const;
const ACTIVO = { si: true, no: false } as const;

const deLaLista = <T extends Readonly<Record<string, boolean>>>(
  tabla: T,
  valor: string,
): boolean | undefined | null =>
  valor === "" ? undefined : Object.hasOwn(tabla, valor) ? tabla[valor as keyof T] : null;

/** Lo que acepta `listarRecetas`, o `null` si nada puede coincidir con lo pedido. */
export function leerLaEntradaDeLaListaDeRecetas(
  entrada: EntradaDeLaListaDeRecetas,
): EntradaDeListarRecetas | null {
  const texto = textoDeBusquedaDeProductoDesdeTexto(entrada.texto);
  const conReceta = deLaLista(CON_RECETA, entrada.conReceta);
  const activo = deLaLista(ACTIVO, entrada.activo);
  const pagina = entrada.despues === "" ? undefined : leerLaPagina(entrada.despues);
  if (!texto.ok || conReceta === null || activo === null || pagina === null) return null;
  return {
    ...(texto.valor === null ? {} : { texto: texto.valor }),
    ...(conReceta === undefined ? {} : { conReceta }),
    ...(activo === undefined ? {} : { activo }),
    ...(pagina === undefined ? {} : { despuesDe: pagina }),
  };
}

/** Lo que acepta `ingredientesParaReceta`, o `null` si nada puede coincidir con lo pedido. */
export function leerLaEntradaDeLosIngredientes(
  entrada: EntradaDeLosIngredientes,
): EntradaDeIngredientes | null {
  const texto = textoDeBusquedaDeProductoDesdeTexto(entrada.texto);
  const pagina = entrada.despues === "" ? undefined : leerLaPagina(entrada.despues);
  if (!texto.ok || pagina === null) return null;
  return {
    ...(texto.valor === null ? {} : { texto: texto.valor }),
    ...(pagina === undefined ? {} : { despuesDe: pagina }),
  };
}
