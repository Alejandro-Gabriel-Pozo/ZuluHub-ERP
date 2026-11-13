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
export { CLASES_DE_USO, esClaseDeUso, seConsumeLaClase } from "./dominio/clases";
export type { AlcanceDePrecio, ErrorDeAlcanceDePrecio } from "./dominio/alcance-de-precio";
export { ALCANCES_DE_PRECIO, sucursalDelAlcanceDePrecio } from "./dominio/alcance-de-precio";
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

// La carta pública y el botón «Ocultar» (carta real §3.2 y §3.2b): el dato es del catálogo; los casos de uso (T2) y el adaptador de lectura (T3) los leen por estos tipos.
export type { CartaPublica, Disponibilidad, EstadoDeCarta } from "./dominio/carta-publica";
export { ocultoPor } from "./dominio/carta-publica";
export type { CartaPublicaId } from "./dominio/identificadores";
export {
  crearRepositorioDeCartas,
  type AltaDeCartaPublica,
  type CambiosDeCartaPublica,
  type RepositorioDeCartas,
} from "./persistencia/repositorio-de-cartas";
export type {
  CartaLeida,
  GrupoLeido,
  OpcionLeida,
  PrecioLeido,
  ProductoLeido,
} from "./dominio/carta-publicada";
export { armarVidrieraPublicada } from "./dominio/carta-publicada";
export {
  crearLecturaPublicaDeCartas,
  type LecturaPublicaDeCartas,
  type PublicoDeCartaDb,
} from "./persistencia/lector-publico-de-carta";
export { crearLectorDeCarta, type LectorDeCarta } from "./persistencia/lector-de-carta";
export {
  crearRepositorioDeSecciones,
  type RepositorioDeSecciones,
} from "./persistencia/repositorio-de-secciones";
export {
  crearRepositorioDeDisponibilidad,
  type FijarDisponibilidad,
  type RepositorioDeDisponibilidad,
} from "./persistencia/repositorio-de-disponibilidad";

export type { AlcanceDeExistencia, ExistenciasDelProducto } from "./casos-de-uso/contrato";
export type {
  EntradaDeGuardarCartaPublica,
  SalidaDeGuardarCartaPublica,
} from "./casos-de-uso/guardar-carta-publica";
export type {
  AlcanceDeOcultamiento,
  EntradaDeOcultarProducto,
  SalidaDeOcultarProducto,
} from "./casos-de-uso/ocultar-producto";
export type {
  EntradaDeReordenarSecciones,
  SalidaDeReordenarSecciones,
} from "./casos-de-uso/reordenar-secciones";
export type {
  CartaParaAdministrar,
  ProductoOcultoParaAdministrar,
  VistaDeCartaPublica,
} from "./consultas/consultas-de-carta";

export { insertarIdempotente } from "./persistencia/insertar-idempotente";
export {
  crearRepositoriosDeCatalogo,
  type RepositoriosDeCatalogo,
} from "./persistencia/repositorios-de-catalogo";
export type { ConsumoDeVersion, ProductoParaStock, ProductosParaStock } from "./lector-para-stock";

// Presentaciones de compra de un producto (E9 §3.2, X5): el dato es del catálogo; compras lo lee por estos tipos y por el repositorio de la `Tx`.
export { esClaseComprable } from "./dominio/clase-comprable";
export type {
  EntradaDeCrearPresentacion,
  EntradaDeEditarPresentacion,
  SalidaDeCrearPresentacion,
} from "./casos-de-uso/presentaciones";
export {
  crearRepositorioDePresentaciones,
  type PresentacionGuardada,
  type RepositorioDePresentaciones,
} from "./persistencia/repositorio-de-presentaciones";
