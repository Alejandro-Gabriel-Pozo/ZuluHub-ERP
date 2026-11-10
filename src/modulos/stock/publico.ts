/**
 * Entrada pública del módulo de stock (ADR-001; E5): los demás módulos (ventas, cierre, la composición) solo importan de acá. Crece por
 * tramos: hoy trae la persistencia (T3: esquema, repositorios y el lector del catálogo); los casos de uso y las consultas de depósitos y
 * artículos llegan con T4, y el registro en la composición y los puertos de ventas con T7 y T8.
 */
export { COLUMNAS_DE_STOCK, type StockDb } from "./persistencia/esquema";
export { ERRORES_DE_STOCK_POR_RESTRICCION } from "./persistencia/errores-por-restriccion";
export {
  COLUMNAS_DE_CATALOGO_QUE_LEE_STOCK,
  DECIMALES_DE_CATALOGO_QUE_LEE_STOCK,
} from "./persistencia/tablas";
export {
  crearRepositoriosDeStock,
  type RepositoriosDeStock,
} from "./persistencia/repositorios-de-stock";
export { llaveDeSaldo, type ParDeSaldo } from "./persistencia/repositorio-de-movimientos";
export {
  ESTADOS_DE_CONTEO,
  USOS_DE_DEPOSITO,
  type Articulo,
  type Conteo,
  type Deposito,
  type Movimiento,
  type RegistroGuardado,
  type RenglonGuardado,
  type UsoDeDeposito,
} from "./persistencia/modelo";
