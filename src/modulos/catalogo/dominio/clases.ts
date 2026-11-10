/**
 * Las cinco clases de uso de un producto (decisión 131) y lo que cada una pide y prohíbe (§3.3). La clase se elige al crear y no cambia.
 * Lo hace cumplir también la base (CHECK y disparadores de 0025): esto es el mismo cuadro, para decidir antes de escribir.
 */
export const CLASES_DE_USO = [
  "MATERIA_PRIMA",
  "INSUMO",
  "REVENTA",
  "ELABORADO",
  "VENDIBLE",
] as const;
export type ClaseDeUso = (typeof CLASES_DE_USO)[number];

export const esClaseDeUso = (texto: string): texto is ClaseDeUso =>
  (CLASES_DE_USO as readonly string[]).includes(texto);

const CLASES_QUE_VENDEN: readonly ClaseDeUso[] = ["REVENTA", "VENDIBLE"];
/** Lo que una opción puede consumir (139; el prototipo ofrece materia prima, insumo y reventa). */
const CLASES_QUE_SE_CONSUMEN: readonly ClaseDeUso[] = ["MATERIA_PRIMA", "INSUMO", "REVENTA"];

/** Reventa y producto vendible: llevan alícuota, sección, nombre de cocina, descripción, precio y opciones. */
export const vendeLaClase = (clase: ClaseDeUso): boolean => CLASES_QUE_VENDEN.includes(clase);
export const seConsumeLaClase = (clase: ClaseDeUso): boolean =>
  CLASES_QUE_SE_CONSUMEN.includes(clase);
