/**
 * Entrada pública del módulo del portal de la empresa (ADR-001; migraciones 0078 y 0083): el dominio puro, el repositorio, el guardado, la consulta de administración y la
 * lectura pública por código. La ruta pública y las pantallas son de los tramos siguientes.
 */
export { crearCasosDeUsoDePortal, type CasosDeUsoDePortal } from "./casos-de-uso/casos-de-uso";
export { DECLARACIONES as DECLARACIONES_DE_PORTAL } from "./casos-de-uso/declaraciones";
export { DECLARACIONES_DE_CONSULTAS as DECLARACIONES_DE_CONSULTAS_DE_PORTAL } from "./consultas/declaraciones";
export {
  crearConsultasDePortal,
  type ConsultasDePortal,
  type PortalParaAdministrar,
  type TxDeConsultasDePortal,
} from "./consultas/consultas";
export type {
  EntradaDeGuardarPortal,
  SalidaDeGuardarPortal,
} from "./casos-de-uso/guardar-portal-de-la-empresa";
export type { DependenciasDePortal, TxDePortal } from "./casos-de-uso/contrato";
export type { ErrorDeGuardarPortal } from "./casos-de-uso/errores";
export {
  TOPE_DE_BYTES_DE_LA_IMAGEN_DEL_PORTAL,
  VARIANTES_DE_PORTAL,
  imagenEntraEnElPortal,
  type DatosDelPortal,
  type EntradaDeTarjeta,
  type EntradaDeZona,
  type ErrorDePortal,
  type Imagen,
  type Portal,
  type Tarjeta,
  type VarianteDePortal,
  type Zona,
} from "./dominio/portal";
export {
  COLUMNAS_DE_PORTAL,
  COLUMNAS_PUBLICAS_DE_PORTAL,
  ERRORES_DE_PORTAL_POR_RESTRICCION,
  type TablasDePortal,
} from "./persistencia/esquema";
export {
  crearRepositorioDePortales,
  type PortalDb,
  type RepositorioDePortales,
} from "./persistencia/repositorio-de-portales";
export { armarPortalPublicado } from "./dominio/portal-publicado";
export {
  crearLecturaPublicaDePortales,
  type CartaDelPortal,
  type LecturaPublicaDePortales,
  type PortalLeido,
  type PublicoDePortalDb,
} from "./persistencia/lector-publico-de-portal";
