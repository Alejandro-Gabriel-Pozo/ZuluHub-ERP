/**
 * Entrada pública del módulo de catálogo (ADR-001; E2 mínimo): los demás módulos (ventas, la carta, el facturador) solo importan de acá.
 */
export { DECLARACIONES as DECLARACIONES_DE_CATALOGO } from "./casos-de-uso/declaraciones";
export { DECLARACIONES_DE_CONSULTAS as DECLARACIONES_DE_CONSULTAS_DE_CATALOGO } from "./consultas/declaraciones";
export { crearCasosDeUsoDeCatalogo, type CasosDeUsoDeCatalogo } from "./casos-de-uso/casos-de-uso";
export { crearConsultasDeCatalogo, type ConsultasDeCatalogo } from "./consultas/consultas";
export type {
  EstadoDeProducto,
  FichaDeProducto,
  GrupoDeFicha,
  OpcionDeFicha,
  PaginaDeProductos,
  PreciosDelProducto,
  PrecioDeLista,
  ProductoDeLista,
} from "./consultas/consultas";
export {
  cotizarParaVender,
  tienePrecioParaLaCartaEnSucursal,
  type EntradaDeCotizarParaVender,
} from "./casos-de-uso/cotizar-para-vender";
export type {
  DependenciasDeCatalogo,
  DependenciasDeConsultasDeCatalogo,
  LecturasDeCatalogo,
  TxDeCatalogo,
  TxDeConsultasDeCatalogo,
} from "./casos-de-uso/contrato";
export type { ErrorDeCatalogo } from "./casos-de-uso/errores";
export type {
  EntradaDeCrearProducto,
  EntradaDeCrearProductoRapido,
  SalidaDeCrearProducto,
} from "./casos-de-uso/crear-producto";
export type {
  EntradaDeEditarProducto,
  SalidaDeEditarProducto,
  SalidaDeCambiarActivo,
} from "./casos-de-uso/editar-producto";
export type { EntradaDeCambiarPrecio, SalidaDeCambiarPrecio } from "./casos-de-uso/cambiar-precio";
export type {
  EntradaDeCambiarFormaDeVenta,
  SalidaDeCambiarFormaDeVenta,
} from "./casos-de-uso/cambiar-forma-de-venta";
export type {
  EntradaDeEditarOpciones,
  SalidaDeEditarOpciones,
} from "./casos-de-uso/editar-opciones";
export type {
  EntradaDeGuardarConsumoDeGrupo,
  SalidaDeGuardarConsumoDeGrupo,
} from "./casos-de-uso/guardar-consumo";
export type {
  EntradaDeCopiarOpciones,
  SalidaDeCopiarOpciones,
} from "./casos-de-uso/copiar-opciones";
export type {
  EntradaDeCrearSeccion,
  EntradaDeEditarSeccion,
  SalidaDeCrearSeccion,
  SalidaDeEditarSeccion,
} from "./casos-de-uso/secciones";
export type { GrupoPedido, OpcionPedida } from "./dominio/opciones";
export type {
  InstantaneaDeProducto,
  ErrorDeCotizacion,
  OpcionCotizada,
  VarianteCotizada,
  OrigenDelPrecio,
  OrigenDelRecargo,
} from "./dominio/cotizar";
export type { ClaseDeUso } from "./dominio/clases";
export { CLASES_DE_USO, seConsumeLaClase } from "./dominio/clases";
export type { FormaDeVenta } from "./dominio/forma-de-venta";
export { formaDeVentaDelPiloto } from "./dominio/forma-de-venta";
export type { FilaDePrecio, Producto } from "./dominio/modelo";
export { tienePrecioParaLaCarta } from "./dominio/cotizar";
export type {
  ProductoId,
  OpcionId,
  VersionDeOpcionId,
  PrecioDeVentaId,
  SeccionDeCartaId,
  GrupoDeEleccionesId,
  CopiaDeOpcionesId,
} from "./dominio/identificadores";
export {
  COLUMNAS_DE_CATALOGO,
  ERRORES_DE_CATALOGO_POR_RESTRICCION,
  type CatalogoDb,
} from "./persistencia/esquema";
export {
  crearRepositorioDeProductos,
  type RepositorioDeProductos,
  type SeccionDeCarta,
} from "./persistencia/repositorio-de-productos";
export {
  crearRepositorioDeOpciones,
  type RepositorioDeOpciones,
} from "./persistencia/repositorio-de-opciones";
export {
  crearRepositorioDePrecios,
  type RepositorioDePrecios,
} from "./persistencia/repositorio-de-precios";

export { insertarIdempotente } from "./persistencia/insertar-idempotente";
export {
  crearRepositoriosDeCatalogo,
  type RepositoriosDeCatalogo,
} from "./persistencia/repositorios-de-catalogo";
export type { ConsumoDeVersion, ProductoParaStock, ProductosParaStock } from "./lector-para-stock";
