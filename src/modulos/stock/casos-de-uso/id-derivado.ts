import { createHash } from "node:crypto";

/**
 * Un id (UUID de forma v5) derivado de un texto: determinista, así un reintento de la transacción escribe lo MISMO y no hay azar en el
 * código de stock. Sirve para lo que la aplicación identifica por contenido (el lote «sin asignar» de un artículo, una reasignación de
 * apertura). Previene un lote o una reasignación duplicados por un reintento.
 */
export function idDerivado(texto: string): string {
  const hex = Array.from(createHash("sha1").update(texto).digest("hex"));
  hex[12] = "5"; // versión
  hex[16] = "a"; // variante
  return hex.join("").replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, "$1-$2-$3-$4-$5");
}
