import type { Kysely } from "kysely";
import type { ProductosParaStock } from "../../catalogo/publico";
import type { StockDb } from "./esquema";
import { crearRepositorioDeCostos, type RepositorioDeCostos } from "./costos";
import { crearProductosParaStock } from "./productos-para-stock";
import {
  crearRepositorioDeArticulos,
  type RepositorioDeArticulos,
} from "./repositorio-de-articulos";
import {
  crearRepositorioDeComposiciones,
  type RepositorioDeComposiciones,
} from "./repositorio-de-composiciones";
import { crearRepositorioDeConteos, type RepositorioDeConteos } from "./repositorio-de-conteos";
import {
  crearRepositorioDeDepositos,
  type RepositorioDeDepositos,
} from "./repositorio-de-depositos";
import { crearLecturasDeLotes, type LecturasDeLotes } from "./lecturas-de-lotes";
import {
  crearRepositorioDeReasignaciones,
  type RepositorioDeReasignaciones,
} from "./repositorio-de-reasignaciones";
import { crearRepositorioDeLotes, type RepositorioDeLotes } from "./repositorio-de-lotes";
import {
  crearRepositorioDeMovimientos,
  type RepositorioDeMovimientos,
} from "./repositorio-de-movimientos";

/**
 * Los repositorios de stock, armados sobre la MISMA conexión de la transacción. La composición los junta con los de catálogo, caja y ventas en
 * UNA sola `Tx` (`TxDeApp`): por eso los nombres genéricos llevan `DeStock` (caja ya tiene `movimientos`; `productosParaStock` es el lector del
 * catálogo, que no se llama `productos` para no pisar a su repositorio). Una prueba de la composición exige que ninguna clave se repita.
 */
export type RepositoriosDeStock = Readonly<{
  depositos: RepositorioDeDepositos;
  articulosDeStock: RepositorioDeArticulos;
  movimientosDeStock: RepositorioDeMovimientos;
  conteosDeStock: RepositorioDeConteos;
  composicionesDeStock: RepositorioDeComposiciones;
  costosDeStock: RepositorioDeCostos;
  /** E6 (0032): lotes, control de lote y lotes de cada renglón del libro. */
  lotesDeStock: RepositorioDeLotes & LecturasDeLotes & RepositorioDeReasignaciones;
  productosParaStock: ProductosParaStock;
}>;

export function crearRepositoriosDeStock(db: {
  withTables<T extends object>(): Kysely<T & StockDb>;
}): RepositoriosDeStock {
  const conexion = db.withTables<StockDb>();
  return {
    depositos: crearRepositorioDeDepositos(conexion),
    articulosDeStock: crearRepositorioDeArticulos(conexion),
    movimientosDeStock: crearRepositorioDeMovimientos(conexion),
    conteosDeStock: crearRepositorioDeConteos(conexion),
    composicionesDeStock: crearRepositorioDeComposiciones(conexion),
    costosDeStock: crearRepositorioDeCostos(conexion),
    lotesDeStock: {
      ...crearRepositorioDeLotes(conexion),
      ...crearLecturasDeLotes(conexion),
      ...crearRepositorioDeReasignaciones(conexion),
    },
    productosParaStock: crearProductosParaStock(conexion),
  };
}
