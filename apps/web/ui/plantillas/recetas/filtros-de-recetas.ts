/**
 * Lo que dice la dirección de la lista de recetas (maqueta aprobada `receta.html`, 15/11/2026: «Todas» y «Sin receta») y las direcciones de la lista, de una receta y de su ficha de cocina.
 * Puro: sin React ni servidor. Los filtros son ENLACES (no campos): `?receta=sin`. La validez la decide el servidor (`src/composicion/entradas-de-recetas.ts`); acá se vuelve «Todas» lo que no
 * es una opción conocida, para que lo que se ve y lo que se pidió coincidan. Previene: una opción del filtro que la composición no acepta (una prueba compara las dos listas).
 */

export const RUTA_DE_RECETAS = "/catalogo/recetas";

/** Los valores que ofrece el filtro de la dirección; «Todas» es no filtrar. Una prueba los compara con los que acepta la composición (`conReceta`). */
export const FILTROS_DE_RECETAS = ["sin"] as const;

/** Vacío es «sin filtrar» (Todas). */
export type FiltroDeRecetas = (typeof FILTROS_DE_RECETAS)[number] | "";

type ParametrosDeLaDireccion = Readonly<Record<string, string | readonly string[] | undefined>>;

const primero = (params: ParametrosDeLaDireccion, nombre: string): string => {
  const valor = params[nombre];
  return (
    (Array.isArray(valor) ? (valor[0] as string | undefined) : (valor as string | undefined)) ?? ""
  );
};

/** El filtro de la dirección, con lo que no es una opción conocida vuelto a «Todas». */
export const leerElFiltroDeRecetas = (params: ParametrosDeLaDireccion): FiltroDeRecetas =>
  FILTROS_DE_RECETAS.find((permitido) => permitido === primero(params, "receta")) ?? "";

/** La clave de la página que sigue, tal como la dio la consulta; `""` en la primera. */
export const leerLaPaginaDeRecetas = (params: ParametrosDeLaDireccion): string =>
  primero(params, "despues");

/** La dirección de la lista con ese filtro y, si sigue, la página. */
export function direccionDeLaListaDeRecetas(
  filtro: FiltroDeRecetas,
  despues: string | null,
): string {
  const pares: [string, string][] = [];
  if (filtro !== "") pares.push(["receta", filtro]);
  if (despues !== null) pares.push(["despues", despues]);
  return pares.length === 0
    ? RUTA_DE_RECETAS
    : `${RUTA_DE_RECETAS}?${new URLSearchParams(pares).toString()}`;
}

/** La dirección de la ficha de una receta. El id lo dio el servidor (un UUID): no se arma desde el navegador. */
export const rutaDeLaReceta = (productoId: string): string => `${RUTA_DE_RECETAS}/${productoId}`;

/** La dirección de la ficha de cocina de una receta. */
export const rutaDeLaCocina = (productoId: string): string =>
  `${rutaDeLaReceta(productoId)}/cocina`;

/** La dirección de la receta nueva; con un producto (el de «Este producto no tiene receta») lo deja elegido. El id lo dio el servidor (un UUID): no se arma desde el navegador. */
export const rutaDeLaRecetaNueva = (productoId: string | null = null): string =>
  productoId === null
    ? `${RUTA_DE_RECETAS}/nueva`
    : `${RUTA_DE_RECETAS}/nueva?${new URLSearchParams([["producto", productoId]]).toString()}`;

/** La dirección de editar una receta (guarda una versión nueva). */
export const rutaDeEditarLaReceta = (productoId: string): string =>
  `${rutaDeLaReceta(productoId)}/editar`;

/** El producto que pide la dirección de la receta nueva (`?producto=`); la página lo usa solo si es uno de los que se ofrecen. `""` si no hay. */
export const leerElProductoDeLaDireccion = (params: ParametrosDeLaDireccion): string =>
  primero(params, "producto");
