/**
 * La clasificación comercial de un producto con vigencia (A2b, decisión 60 y maqueta `clasificacion.html`): una lista de vínculos de solo inserción (producto → nodo, o «Sin
 * elegir» si el nodo es `null`), cada uno desde un instante. Rige el último con `vigenteDesde <= ahora`; los de fecha futura son los PROGRAMADOS y conviven con el vigente (rigen
 * cuando llega su fecha, sin nadie que los active). Cambiar la clasificación agrega un vínculo nuevo: nunca se edita ni se borra uno (el anterior queda además en la auditoría). Es
 * la misma regla de `precio_vigente`, en una función pura sobre los vínculos ya leídos: la usan la consulta de la ficha y, en T-D, la venta que copia el camino al renglón.
 */
export type VinculoDeClasificacion = Readonly<{
  id: string;
  /** `null` = «Sin elegir». */
  nodoId: string | null;
  vigenteDesde: Date;
}>;

export type ClasificacionDelProducto<V extends VinculoDeClasificacion = VinculoDeClasificacion> =
  Readonly<{
    /** `null` si nunca se clasificó (o solo hay vínculos programados todavía): el producto está «Sin elegir». */
    vigente: V | null;
    /** Los que rigen en el futuro, del más próximo al más lejano. */
    programados: readonly V[];
  }>;

export function clasificacionDelProducto<V extends VinculoDeClasificacion>(
  vinculos: readonly V[],
  ahora: Date,
): ClasificacionDelProducto<V> {
  let vigente: V | null = null;
  const programados: V[] = [];
  for (const v of vinculos) {
    if (v.vigenteDesde.getTime() > ahora.getTime()) programados.push(v);
    else if (vigente === null || v.vigenteDesde.getTime() > vigente.vigenteDesde.getTime())
      vigente = v;
  }
  programados.sort((a, b) => a.vigenteDesde.getTime() - b.vigenteDesde.getTime());
  return { vigente, programados };
}
