/**
 * Entrada pública del módulo de compras (ADR-001; E9): los demás módulos (la composición, E6 para el costo de las recetas) solo importan de acá. Trae los casos
 * de uso y las consultas con sus declaraciones (X1) y la persistencia que la composición arma sobre la conexión de cada transacción.
 */
export { DECLARACIONES as DECLARACIONES_DE_COMPRAS } from "./casos-de-uso/declaraciones";
export { DECLARACIONES_DE_CONSULTAS as DECLARACIONES_DE_CONSULTAS_DE_COMPRAS } from "./consultas/declaraciones";
export { crearCasosDeUsoDeCompras, type CasosDeUsoDeCompras } from "./casos-de-uso/casos-de-uso";
export { crearConsultasDeCompras, type ConsultasDeCompras } from "./consultas/consultas";
export type {
  CodigoDeEgresoDeCaja,
  DependenciasDeCompras,
  DependenciasDeConsultasDeCompras,
  EgresoDeCaja,
  IvaDeLaEmpresa,
  TxDeCompras,
  TxDeConsultasDeCompras,
} from "./casos-de-uso/contrato";
export {
  ALICUOTAS_DE_COMPRA,
  PUNTO_DE_VENTA_MAXIMO,
  PUNTO_DE_VENTA_MINIMO,
  TIPOS_DE_COMPROBANTE_DE_PROVEEDOR,
  type TipoDeComprobanteDeProveedor,
} from "./dominio/comprobante";
export {
  CONDICIONES_DE_IVA_DE_LA_EMPRESA,
  type CondicionDeIvaDeLaEmpresa,
} from "./dominio/comprobante";
export { MEDIOS_DE_PAGO, type MedioDePago } from "./dominio/pago";
export type { ErrorDeCompras } from "./casos-de-uso/errores";
export {
  NIVELES_DE_COMPRA,
  NIVELES_ESTANDAR_DE_COMPRA,
  NIVEL_INICIAL_DE_COMPRA,
  esNivelDeCompra,
  type NivelDeCompra,
} from "./dominio/niveles";
export type { NivelDeComprasVigente } from "./consultas/nivel";
export {
  FORMA_DEL_CURSOR as FORMA_DEL_CURSOR_DE_COMPRAS,
  type CompraDeLista,
  type FacturaDeLista,
  type FichaDeCompra,
  type PaginaDeCompras,
} from "./casos-de-uso/lectura";
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
