/**
 * Entrada pública del módulo de producción (ADR-001; E6): los demás módulos (la composición, las pantallas) solo importan de acá. Trae los casos de uso
 * y las consultas con sus declaraciones (X1) y la persistencia que la composición arma sobre la conexión de cada transacción. Producción consume a stock
 * solo por `stock/publico.ts` y no escribe tablas de stock.
 */
export { DECLARACIONES as DECLARACIONES_DE_PRODUCCION } from "./casos-de-uso/declaraciones";
export { DECLARACIONES_DE_CONSULTAS as DECLARACIONES_DE_CONSULTAS_DE_PRODUCCION } from "./consultas/declaraciones";
export {
  crearCasosDeUsoDeProduccion,
  type CasosDeUsoDeProduccion,
} from "./casos-de-uso/casos-de-uso";
export { crearConsultasDeProduccion, type ConsultasDeProduccion } from "./consultas/consultas";
export type {
  DependenciasDeConsultasDeProduccion,
  DependenciasDeProduccion,
  TxDeConsultasDeProduccion,
  TxDeProduccion,
} from "./casos-de-uso/contrato";
export type { ErrorDeProduccion } from "./casos-de-uso/errores";
export type {
  EntradaDeAbrirOrden,
  EsperadoDeOrden,
  FaltanteDeOrden,
  SalidaDeAbrirOrden,
} from "./casos-de-uso/abrir-orden";
export type {
  ConsumoRealDeEntrada,
  EntradaDeCerrarOrden,
  SalidaDeCerrarOrden,
} from "./casos-de-uso/cerrar-orden";
export type {
  EntradaDeAnularOrden,
  EntradaDeCancelarOrden,
  SalidaDeAnularOrden,
  SalidaDeCancelarOrden,
} from "./casos-de-uso/cancelar-y-anular";
export type { FichaDeOrden, OrdenDeLista, RenglonDeFichaDeOrden } from "./consultas/ordenes";
export {
  crearRepositoriosDeProduccion,
  type RepositoriosDeProduccion,
} from "./persistencia/repositorios-de-produccion";
export { COLUMNAS_DE_PRODUCCION } from "./persistencia/columnas";
export { ERRORES_DE_PRODUCCION_POR_RESTRICCION } from "./persistencia/errores-por-restriccion";
