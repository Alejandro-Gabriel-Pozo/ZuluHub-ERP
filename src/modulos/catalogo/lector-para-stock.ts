import type { EmpresaId } from "../../primitivas/identificadores/marca";
import type { ClaseDeUso } from "./dominio/clases";

/**
 * Lo que el catálogo deja leer a stock (E5 §3.3): el producto que se controla o se compone (clase, activo, unidad base, dimensión) y lo que
 * consume cada versión de opción. Es el CONTRATO; lo implementa `stock/persistencia`, que lee las columnas que declara su `tablas.ts` (stock
 * requiere catalogo; una prueba compara esas columnas con las del catálogo). Solo tipos: el catálogo no lee ni escribe nada de stock.
 * Previene: que stock lea de un producto algo que el catálogo no promete (cada campo nuevo se pide acá y se prueba contra el esquema).
 */
export type ProductoParaStock = Readonly<{
  id: string;
  nombre: string;
  /** El nombre comparado sin distinguir mayúsculas (la base lo guarda; sirve para ordenar y buscar). */
  nombreClave: string;
  claseDeUso: ClaseDeUso;
  activo: boolean;
  /** La unidad base: inmutable, y la unidad de stock del artículo. */
  unidadBaseId: string;
  dimension: string;
}>;

/** Una línea de `consumo_de_opcion`: cuánto del insumo consume la opción por unidad vendida, en la unidad base del insumo (texto decimal exacto). */
export type ConsumoDeVersion = Readonly<{
  insumoId: string;
  cantidad: string;
  escalaConTamano: boolean;
}>;

export interface ProductosParaStock {
  obtener(empresa: EmpresaId, id: string): Promise<ProductoParaStock | null>;
  /**
   * Lo mismo con `SELECT … FOR SHARE`: quien lo lee para controlar o componer espera a quien lo está desactivando (o ve el producto ya
   * desactivado). No se puede usar en una transacción de solo lectura.
   */
  bloquearCompartido(empresa: EmpresaId, id: string): Promise<ProductoParaStock | null>;
  /** Los productos de esos ids (los que no existen no vuelven), activos o no. */
  porIds(empresa: EmpresaId, ids: readonly string[]): Promise<ProductoParaStock[]>;
  /** Lo que consume cada versión de opción (vigente o vieja, inmutable una vez sellada), por id de versión y en orden. */
  consumoDeVersiones(
    empresa: EmpresaId,
    versiones: readonly string[],
  ): Promise<Map<string, ConsumoDeVersion[]>>;
  /** El factor de tamaño de cada versión de opción (texto decimal), por id de versión; 1 por defecto en la base. */
  factoresDeTamano(empresa: EmpresaId, versiones: readonly string[]): Promise<Map<string, string>>;
}
