/**
 * Entrada pública del módulo de comandas (ADR-001; E7): los envíos a cocina numerados, el aviso de anulación, el orden de salida y la impresión. Los
 * demás módulos (el salón) solo importan de acá.
 */
export { DECLARACIONES as DECLARACIONES_DE_COMANDAS } from "./casos-de-uso/declaraciones";
export { DECLARACIONES_DE_CONSULTAS as DECLARACIONES_DE_CONSULTAS_DE_COMANDAS } from "./consultas/declaraciones";
export { crearCasosDeUsoDeComandas, type CasosDeUsoDeComandas } from "./casos-de-uso/casos-de-uso";
export { crearConsultasDeComandas, type ConsultasDeComandas } from "./consultas/consultas";
export type { DependenciasDeComandas, TxDeComandas } from "./casos-de-uso/contrato";
export type {
  DependenciasDeConsultasDeComandas,
  TxDeConsultasDeComandas,
} from "./consultas/contrato";
export type { ErrorDeComandas } from "./casos-de-uso/errores";
export type { ErrorDeConsultaDeComandas } from "./consultas/consultas";
export { enviarACocinaEnTx, pedirQueSalgaEnTx } from "./casos-de-uso/envios";
export { anularItemEnviadoEnTx } from "./casos-de-uso/anulaciones";
export type {
  EntradaDeEnviarACocina,
  EntradaDePedirQueSalga,
  SalidaDeEnvio,
} from "./casos-de-uso/envios";
export type {
  EntradaDeAnularItemEnviado,
  EntradaDeCambiarSalida,
  EntradaDeQuitarSinEnviar,
  SalidaDeAnularItemEnviado,
  SalidaDeCambiarSalida,
  SalidaDeQuitarSinEnviar,
} from "./casos-de-uso/anulaciones";
export type {
  EntradaDeDesactivarImpresora,
  EntradaDeEditarImpresora,
  EntradaDeRegistrarImpresora,
  SalidaDeDesactivarImpresora,
  SalidaDeImpresora,
} from "./casos-de-uso/impresoras";
export type {
  EntradaDeDeclararResultado,
  EntradaDeSolicitarCopia,
  EntradaDeSolicitarImpresion,
  SalidaDeDeclararResultado,
  SalidaDeImpresion,
} from "./casos-de-uso/impresion";
export {
  copiarEstadoDeComandaEnTx,
  estadoDeComandaDeLineas,
  platosPendientesEnTx,
  registrarLineaDeComandaEnTx,
  resumenDeComandasPorCuentas,
  type EstadoDeComandaDeLinea,
} from "./casos-de-uso/lineas-de-comanda";
export type { ModeloDePapel } from "./dominio/documento";
export type { SalidaDeLinea } from "./dominio/envio";
export { COLUMNAS_DE_COMANDAS, type ComandasDb } from "./persistencia/esquema";
export { ERRORES_DE_COMANDAS_POR_RESTRICCION } from "./persistencia/restricciones";
export {
  crearRepositoriosDeComandas,
  type RepositoriosDeComandas,
} from "./persistencia/repositorios-de-comandas";
export type { RepositorioDeEnvios } from "./persistencia/repositorio-de-envios";
export type { RepositorioDeImpresion } from "./persistencia/repositorio-de-impresion";
