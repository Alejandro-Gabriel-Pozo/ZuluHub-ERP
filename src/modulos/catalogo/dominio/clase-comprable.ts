/**
 * Qué se puede comprar (E9 §3.3; D131): materia prima, insumo y reventa. Un producto elaborado o vendible (el plato, la carta) no se compra: se elabora o se
 * vende. Lista de PERMITIDOS: una clase que nadie pensó queda afuera. Una prueba (`compras-persistencia.test.ts`) compara estas con las de la base.
 */
export const CLASES_COMPRABLES = ["MATERIA_PRIMA", "INSUMO", "REVENTA"] as const;

export function esClaseComprable(clase: string): boolean {
  return (CLASES_COMPRABLES as readonly string[]).includes(clase);
}
