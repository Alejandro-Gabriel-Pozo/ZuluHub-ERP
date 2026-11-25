import type { ClaveDeTexto } from "../../../../../src/capacidades/vocabulario/catalogo";
import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import { costoRedondeado } from "../produccion/modelo-de-orden";
import {
  direccionDeLaListaDeRecetas,
  rutaDeLaReceta,
  type FiltroDeRecetas,
} from "./filtros-de-recetas";

/**
 * El modelo de vista de la lista de recetas (maqueta aprobada `receta.html`, 15/11/2026): de lo que entrega la composición, lo que se ve en cada fila y NADA más. Puro: sin React ni
 * servidor. Una fila lleva el nombre del producto y, a la derecha, «Costo de la comida» (solo si la consulta lo trajo, o sea con `costos.ver`; «Sin costo» si no se sabe, nunca cero) o,
 * si no tiene receta, «Sin receta». Sin precio, margen ni food cost (el dueño, 15/11/2026: «Costo de la comida» es el único cálculo). El costo se MUESTRA a 2 decimales con la primitiva
 * de dinero (la misma de Producción: `costoRedondeado`). Los textos salen del catálogo (ya aprobados); sin recetas, «Sin resultados».
 */

/** Las recetas como las entrega la composición (la misma forma, sin importar de dónde venga; la UI no importa la composición). */
export type RecetasDeLaLista = Readonly<{
  recetas: readonly Readonly<{
    productoId: string;
    nombre: string;
    version: number | null;
    costoPorUnidad?: string | null | undefined;
  }>[];
  siguiente: string | null;
}>;

type FiltroArmado = Readonly<{ href: string; texto: string; actual: boolean }>;

type FilaDeReceta = Readonly<{
  id: string;
  href: string;
  nombre: string;
  /** El costo de la comida o «Sin costo» (solo con `costos.ver` y receta); `null` si no corresponde mostrarlo. */
  costo: string | null;
  /** «Sin receta» si el producto no tiene; `null` si tiene. */
  sinReceta: string | null;
}>;

export type ListaDeRecetasArmada = Readonly<{
  filtros: readonly FiltroArmado[];
  filas: readonly FilaDeReceta[];
  /** «Sin resultados» si no hay filas; `null` si las hay. */
  vacio: string | null;
  siguiente: Readonly<{ href: string; texto: string }> | null;
}>;

const FILTROS = [
  { filtro: "", clave: "receta.lista.todas" },
  { filtro: "sin", clave: "receta.lista.sin_receta" },
] as const satisfies readonly Readonly<{ filtro: FiltroDeRecetas; clave: ClaveDeTexto }>[];

export function armarLaListaDeRecetas(
  lista: RecetasDeLaLista,
  filtro: FiltroDeRecetas,
  d: DiccionarioResuelto = {},
): ListaDeRecetasArmada {
  return {
    filtros: FILTROS.map((f) => ({
      href: direccionDeLaListaDeRecetas(f.filtro, null),
      texto: texto(d, f.clave),
      actual: f.filtro === filtro,
    })),
    filas: lista.recetas.map((r) => ({
      id: r.productoId,
      href: rutaDeLaReceta(r.productoId),
      nombre: r.nombre,
      costo:
        r.version === null || r.costoPorUnidad === undefined
          ? null
          : r.costoPorUnidad === null
            ? texto(d, "stock.accion.sin_costo")
            : costoRedondeado(r.costoPorUnidad),
      sinReceta: r.version === null ? texto(d, "receta.lista.sin_receta") : null,
    })),
    vacio: lista.recetas.length === 0 ? texto(d, "catalogo.lista.sin_resultados") : null,
    siguiente:
      lista.siguiente === null
        ? null
        : {
            href: direccionDeLaListaDeRecetas(filtro, lista.siguiente),
            texto: texto(d, "fiscal.pantalla.listado_pagina_siguiente"),
          },
  };
}
