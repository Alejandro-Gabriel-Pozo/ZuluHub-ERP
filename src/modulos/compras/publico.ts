/**
 * Entrada pública del módulo de compras (ADR-001; E9): los demás módulos (la composición, E6 para el costo de las recetas) solo importan de acá. Trae los casos
 * de uso y las consultas con sus declaraciones (X1) y la persistencia que la composición arma sobre la conexión de cada transacción.
 */
export { DECLARACIONES as DECLARACIONES_DE_COMPRAS } from "./casos-de-uso/declaraciones";
export { DECLARACIONES_DE_CONSULTAS as DECLARACIONES_DE_CONSULTAS_DE_COMPRAS } from "./consultas/declaraciones";
export { crearCasosDeUsoDeCompras, type CasosDeUsoDeCompras } from "./casos-de-uso/casos-de-uso";
export { crearConsultasDeCompras, type ConsultasDeCompras } from "./consultas/consultas";
export type {
  DependenciasDeCompras,
  DependenciasDeConsultasDeCompras,
  TxDeCompras,
  TxDeConsultasDeCompras,
} from "./casos-de-uso/contrato";
export type { ErrorDeCompras } from "./casos-de-uso/errores";
export type {
  EntradaDeComprobanteDeFicha,
  EntradaDePuntoDeVenta,
  EntradaDeResolverPedido,
  SalidaDeCambioDeFicha,
  SalidaDePedirFicha,
  SalidaDeResolverPedido,
} from "./casos-de-uso/ficha";
export type { FichaDelProveedorParaCompras, OfertaDeProducto } from "./consultas/ficha";
export {
  crearRepositoriosDeCompras,
  type RepositoriosDeCompras,
} from "./persistencia/repositorios-de-compras";
export { ERRORES_DE_COMPRAS_POR_RESTRICCION } from "./persistencia/errores-por-restriccion";
