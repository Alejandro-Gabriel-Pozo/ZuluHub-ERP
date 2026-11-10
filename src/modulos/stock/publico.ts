/**
 * Entrada pública del módulo de stock (ADR-001; E5): los demás módulos (ventas, cierre, la composición) solo importan de acá. Crece por
 * tramos: hoy trae los depósitos y los artículos (T4) y la persistencia (T3); el registro en la composición y los puertos de ventas llegan
 * con T7 y T8.
 */
export { DECLARACIONES as DECLARACIONES_DE_STOCK } from "./casos-de-uso/declaraciones";
export { DECLARACIONES_DE_CONSULTAS as DECLARACIONES_DE_CONSULTAS_DE_STOCK } from "./consultas/declaraciones";
export { crearCasosDeUsoDeStock, type CasosDeUsoDeStock } from "./casos-de-uso/casos-de-uso";
export { crearConsultasDeStock, type ConsultasDeStock } from "./consultas/consultas";
export type {
  DependenciasDeConsultasDeStock,
  DependenciasDeStock,
  TxDeConsultasDeStock,
  TxDeStock,
} from "./casos-de-uso/contrato";
export type { ErrorDeStock } from "./casos-de-uso/errores";
export type {
  EntradaDeCrearDeposito,
  EntradaDeEditarDeposito,
  EntradaDeCambiarActivoDeDeposito,
  SalidaDeCrearDeposito,
  SalidaDeEditarDeposito,
  SalidaDeCambiarActivoDeDeposito,
} from "./casos-de-uso/depositos";
export type {
  EntradaDeControlarArticulo,
  EntradaDeDejarDeControlar,
  SalidaDeControlarArticulo,
  SalidaDeDejarDeControlar,
} from "./casos-de-uso/articulos";
export type { DepositoDeLista } from "./consultas/depositos";
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
