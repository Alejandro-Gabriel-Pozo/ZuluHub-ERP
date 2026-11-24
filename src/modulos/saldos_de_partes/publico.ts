/**
 * La entrada al módulo `saldos_de_partes` (el libro de saldos por parte: lo que una parte, cliente o proveedor, debe o tiene a favor). Entre
 * módulos se entra SOLO por acá. Es un módulo interno, sin pantalla ni permisos propios: otros módulos (Compras, cuenta corriente de clientes)
 * lo usan DENTRO de su propia transacción y autorizan con su propio guard.
 */
export {
  CLASES_DE_ASIENTO,
  SENTIDOS,
  claseDe,
  type ClaseDeAsiento,
  type Sentido,
  type SignoDeClase,
} from "./dominio/clases";
export {
  ORDEN_MAXIMO_DEL_ORIGEN,
  TOPE_DEL_IMPORTE_EN_CENTAVOS,
  armarAsiento,
  detalleDesdeTexto,
  huellaDeAnulacion,
  huellaDeAsiento,
  huellaDeImputacion,
  type EntradaDeAsiento,
  type OrigenDeAsiento,
  type PedidoDeAsiento,
  type ReferenciaDeAsiento,
} from "./dominio/asiento";
export {
  compararCentros,
  conSigno,
  distribucionDelEspejo,
  distribucionValida,
  distribuirPorCentroDeCosto,
  type CentroDeCosto,
  type ErrorDeDistribucion,
  type Reparto,
} from "./dominio/distribucion";
export { ERRORES_DEL_LIBRO, type ErrorDelLibro } from "./dominio/errores";
export {
  repartirLoMasAntiguo,
  type CargoAbierto,
  type ErrorDeReparto,
  type ImputacionRepartida,
} from "./dominio/imputacion";
export { estaVencida } from "./dominio/vencida";
export { COLUMNAS_DE_SALDOS, type SaldosDb } from "./persistencia/esquema";
export {
  ERRORES_DEL_LIBRO_POR_RESTRICCION,
  RESTRICCIONES_DE_DISPARADORES_DEL_LIBRO,
} from "./persistencia/errores-por-restriccion";
export {
  crearRepositorioDeAsientos,
  type AsientoGuardado,
  type AsientoNuevo,
  type RepositorioDeAsientos,
} from "./persistencia/repositorio-de-asientos";
export {
  crearRepositorioDeImputaciones,
  type ImputacionGuardada,
  type ImputacionNueva,
  type ParImputado,
  type RepositorioDeImputaciones,
} from "./persistencia/repositorio-de-imputaciones";
export {
  crearRepositorioDeSaldos,
  type EstadoDeAsiento,
  type CargoPendiente,
  type LadoDePartida,
  type LineaDeCuenta,
  type PartidaAbierta,
  type RepositorioDeSaldos,
} from "./persistencia/repositorio-de-saldos";
export { anularAsientoEnTx, type AsientoAnulado } from "./casos-de-uso/anular-asiento";
export type { TxDeSaldos } from "./casos-de-uso/contrato";
export {
  RENGLONES_MAXIMOS_POR_IMPUTACION,
  deshacerImputacionEnTx,
  imputarEnTx,
  type ImputacionRegistrada,
} from "./casos-de-uso/imputar";
export { registrarAsientoEnTx, type AsientoRegistrado } from "./casos-de-uso/registrar-asiento";
export { traducirErroresDelLibro } from "./casos-de-uso/traducir";
export {
  cargosAbiertos,
  creditosAbiertos,
  estadoDeCuenta,
  saldoDeParte,
  saldoPorCentroDeCosto,
  type LecturaDeSaldos,
} from "./consultas/consultas";
