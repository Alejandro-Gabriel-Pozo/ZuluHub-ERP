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
/**
 * Lo que una opción puede consumir (139; el prototipo ofrece materia prima, insumo y reventa) y, desde la decisión del dueño del 12/11/2026
 * (`decisiones-del-dueno-2026-11.md`, fila «opción que consume un elaborado», CYN 179 Q9), un ELABORADO. La base copia esta lista en
 * `consumo_de_opcion_validar` (0057) y `insumosElegibles` la usa: una sola regla.
 */
const CLASES_QUE_SE_CONSUMEN: readonly ClaseDeUso[] = [
  "MATERIA_PRIMA",
  "INSUMO",
  "REVENTA",
  "ELABORADO",
];
/**
 * Lo que `controlarArticulo` (stock) acepta siempre: materia prima, insumo y reventa. El elaborado y el vendible solo con la perilla `produccion` y una receta (`seProduceLaClase`):
 * por eso no comparte lista con `CLASES_QUE_SE_CONSUMEN`. Previene: que habilitar el consumo de un elaborado en una opción lo deje controlable por arrastre.
 */
const CLASES_QUE_CONTROLAN_STOCK: readonly ClaseDeUso[] = ["MATERIA_PRIMA", "INSUMO", "REVENTA"];

/**
 * Las clases que pueden tener STOCK PROPIO si la empresa enciende la producción (E6, D94): el elaborado y el vendible. Se controlan con la perilla `produccion` y una receta vigente
 * (`controlarArticulo`), no por la lista de `seControlaStockLaClase`. Una sola regla para el caso de uso y para la ficha.
 */
export const seProduceLaClase = (clase: ClaseDeUso): boolean =>
  clase === "ELABORADO" || clase === "VENDIBLE";

/** Reventa y producto vendible: llevan alícuota, sección, nombre de cocina, descripción, precio y opciones. */
export const vendeLaClase = (clase: ClaseDeUso): boolean => CLASES_QUE_VENDEN.includes(clase);
export const seConsumeLaClase = (clase: ClaseDeUso): boolean =>
  CLASES_QUE_SE_CONSUMEN.includes(clase);
export const seControlaStockLaClase = (clase: ClaseDeUso): boolean =>
  CLASES_QUE_CONTROLAN_STOCK.includes(clase);
