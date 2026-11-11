/**
 * Entrada pública del módulo de stock (ADR-001; E5): los demás módulos (ventas, cierre, la composición) solo importan de acá. Trae los casos de uso
 * y las consultas con sus declaraciones (X1), los puertos que ofrece a ventas y a compras (`puertos.ts`), el aporte al cierre del día, el núcleo que
 * escribe un movimiento en la transacción de otro módulo y la persistencia que la composición arma sobre la conexión de cada transacción.
 */
// Lo que stock revisa al cierre del día: el puerto de `cierre` que la composición registra (E5-T8).
export { aporteDeStock, CONTROLES_DE_STOCK, type TxDeAporteDeStock } from "./aporte-al-cierre";
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
export type {
  EntradaDeAjustar,
  EntradaDeRegistrarEntrada,
  EntradaDeRegistrarSalida,
  EntradaDeTransferir,
  RenglonDeAjuste,
  SalidaDeAjustar,
  SalidaDeRegistrarEntrada,
  SalidaDeRegistrarSalida,
  SalidaDeTransferir,
} from "./casos-de-uso/movimientos";
export type {
  EntradaDeAnularMovimiento,
  SalidaDeAnularMovimiento,
} from "./casos-de-uso/anulaciones";
export type {
  EntradaDeAbrirConteo,
  EntradaDeAplicarConteo,
  EntradaDeCancelarConteo,
  EntradaDeRegistrarConteo,
  SalidaDeAbrirConteo,
  SalidaDeAplicarConteo,
  SalidaDeCancelarConteo,
  SalidaDeRegistrarConteo,
} from "./casos-de-uso/conteos";
export type {
  ComponenteDeEntrada,
  EntradaDeGuardarComposicion,
  EntradaDeRetirarComposicion,
  SalidaDeGuardarComposicion,
  SalidaDeRetirarComposicion,
} from "./casos-de-uso/composiciones";
export type { RenglonPedido } from "./casos-de-uso/movimientos-comun";
// El núcleo que escribe un movimiento en la transacción de OTRO módulo (salida por venta, reversión y entrada por origen: E5-T7 y E12).
export {
  buscarRepeticion,
  registrarMovimientoEnTx,
  type MovimientoRegistrado,
  type PedidoDeMovimiento,
} from "./casos-de-uso/movimiento-en-tx";
// E6: lo que la producción reutiliza de stock (una regla, un lugar): el guard, la explosión, el espejo de un movimiento, los faltantes y las constantes del libro.
export {
  autorizar as autorizarEnStock,
  exigirAlcanceDeSucursal,
  traducir as traducirDeStock,
} from "./casos-de-uso/comun";
export { anularPorEspejoEnTx } from "./casos-de-uso/espejo-de-movimiento";
export { evaluarFaltantes } from "./casos-de-uso/faltantes";
export { productosParaExplotar } from "./casos-de-uso/lectura-de-venta";
export { CONTROL_DE_NEGATIVO } from "./casos-de-uso/movimiento-en-tx";
export { leerCantidad, leerDetalle } from "./casos-de-uso/movimientos-comun";
export { fechaValida as fechaCivilValida } from "./casos-de-uso/corregir-lote";
export { explotarConsumo, type ProductoParaExplotar } from "./dominio/explosion";
export { ORIGEN_TRANSFORMACION } from "./dominio/movimiento";
export {
  MOTIVO_CONSUMO_DE_TRANSFORMACION,
  MOTIVO_PRODUCTO_DE_TRANSFORMACION,
} from "./dominio/motivos";
export type { LoteDeEntrada } from "./casos-de-uso/lotes-del-libro";
export type { ControlDeStock } from "./casos-de-uso/errores";
export { huellaDeComando, type CampoDeHuella, type RenglonDeHuella } from "./dominio/huella";
export { traducirMovimiento } from "./casos-de-uso/movimientos-comun";
// Los puertos que stock ofrece a ventas y a compras (E5-T7): contratos, fábricas y los tipos de lo que entra y sale de cada uno.
export {
  crearArticulosDeVenta,
  crearConsumoDeStock,
  crearDepositoDeVenta,
  crearEntradaPorOrigen,
  crearExistenciaParaMostrar,
  crearPuertosDeStock,
  crearReversionDeStock,
  type ArticulosDeVenta,
  type ConsumoDeStock,
  type DepositoDeVenta,
  type DependenciasDePuertosDeStock,
  type EntradaPorOrigen,
  type ExistenciaParaMostrar,
  type PuertosDeStock,
  type ReversionDeStock,
} from "./puertos";
export type {
  AvisoDeSalidaPorVenta,
  ControlDeUnProducto,
  EntradaDeEntradaPorOrigen,
  EntradaDeReversionPorOrigen,
  EntradaDeSalidaPorVenta,
  ExistenciaDeProducto,
  OpcionVendida,
  OrigenDeRecepcion,
  OrigenDeVenta,
  RenglonDeEntradaPorOrigen,
  RenglonDeVenta,
  SalidaDeEntradaPorOrigen,
  SalidaDeReversionPorOrigen,
  SalidaDeSalidaPorVenta,
  TxDeLecturaDeStock,
} from "./casos-de-uso/tipos-de-puertos";
export type { ComponenteDeLaReceta, ComposicionDeProducto } from "./consultas/composiciones";
export type { DepositoDeLista } from "./consultas/depositos";
export type {
  CursorDeExistencias,
  EntradaDeExistencias,
  ExistenciaDeLista,
  PaginaDeExistencias,
} from "./consultas/existencias";
export type {
  CabeceraDeMovimiento,
  CursorDeLibro,
  EntradaDeLibroDeArticulo,
  FichaDeMovimiento,
  PaginaDeLibro,
  RenglonDeFicha,
} from "./consultas/libro";
export type { ConteoDeLista, FichaDeConteo, RegistroDeFicha } from "./consultas/conteos";
export type {
  CostoCongeladoDeRenglon,
  EntradaDeCostoDeRenglon,
  EntradaDeExistenciaValorizada,
  EntradaDeUltimoCostoDeCompra,
  ExistenciaValorizada,
  UltimoCostoDeCompra,
} from "./consultas/costos";
export type { DiferenciaDeSaldo } from "./persistencia/lecturas-del-libro";
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
