/**
 * La fila sin rótulo de una leyenda del modelo (la de la condición del receptor, versión 3 en adelante): ninguna fila si el modelo no la
 * trae o si esa misma leyenda ya salió como nombre del cliente (el consumidor final sin nombre). Aparte de `modelo-de-la-hoja.ts`, que está
 * en el tope de 400 líneas (por eso el tipo es estructural: importarlo haría un ciclo).
 */
export const filaDeLeyenda = (
  valor: string | undefined,
  yaDicha: string,
): readonly { rotulo: null; valor: string }[] =>
  valor === undefined || valor === yaDicha ? [] : [{ rotulo: null, valor }];
