/**
 * Lo que dice la dirección de la lista de órdenes de producción (maqueta aprobada `produccion.html`, 09/11/2026, función `vLista`: «Todas» y «Abiertas»): el filtro de estado y la
 * dirección de la lista y de cada orden. Puro: sin React ni servidor. Los filtros son ENLACES (no campos): `?estado=ABIERTA`. La validez la decide el servidor
 * (`src/composicion/entradas-de-produccion.ts`); acá se vuelve «Todas» lo que no es una opción conocida, para que lo que se ve y lo que se pidió coincidan. Previene: una opción
 * del filtro que la composición no acepta (una prueba compara las dos listas).
 */

export const RUTA_DE_PRODUCCION = "/catalogo/produccion";

/** La dirección de «Nueva orden». */
export const RUTA_DE_NUEVA_ORDEN = `${RUTA_DE_PRODUCCION}/nueva`;

/** Los estados que ofrece el filtro; «Todas» es no filtrar. Una prueba los compara con los que acepta la composición (`ESTADOS_DEL_FILTRO_DE_ORDENES`). */
export const ESTADOS_DEL_FILTRO = ["ABIERTA"] as const;

/** Vacío es «sin filtrar» (Todas). */
export type EstadoDelFiltroDeLaLista = (typeof ESTADOS_DEL_FILTRO)[number] | "";

type ParametrosDeLaDireccion = Readonly<Record<string, string | readonly string[] | undefined>>;

/** El estado de la dirección, con lo que no es una opción conocida vuelto a «Todas». */
export function leerElFiltroDeEstado(params: ParametrosDeLaDireccion): EstadoDelFiltroDeLaLista {
  const valor = params["estado"];
  const primero = Array.isArray(valor)
    ? (valor[0] as string | undefined)
    : (valor as string | undefined);
  return ESTADOS_DEL_FILTRO.find((permitido) => permitido === primero) ?? "";
}

/** La dirección de la lista con ese filtro. */
export function direccionDeLaLista(estado: EstadoDelFiltroDeLaLista): string {
  return estado === "" ? RUTA_DE_PRODUCCION : `${RUTA_DE_PRODUCCION}?estado=${estado}`;
}

/** La dirección de la ficha de una orden. El id lo dio el servidor (un UUID): no se arma desde el navegador. */
export const rutaDeLaOrden = (ordenId: string): string => `${RUTA_DE_PRODUCCION}/${ordenId}`;

/** La dirección de «Cerrar con lo real» de una orden. El id lo dio el servidor (un UUID): no se arma desde el navegador. */
export const rutaDeCierreDeLaOrden = (ordenId: string): string =>
  `${rutaDeLaOrden(ordenId)}/cerrar`;
