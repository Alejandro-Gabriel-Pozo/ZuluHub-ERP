/**
 * La entrada al módulo `cuenta_corriente` (la cuenta corriente de clientes: la ficha de habilitación del cliente a deber, con su plazo y su límite). Entre
 * módulos se entra SOLO por acá. Usa el libro de saldos (`saldos_de_partes`) para leer lo que el cliente debe; el cargo de una venta a cuenta (CC-2) y la cobranza
 * (CC-3) los suman sus propios módulos o tramos. Los casos de uso autorizan con su propio guard (`cuenta_corriente.administrar`) y las consultas con `cuenta_corriente.ver`.
 */
export {
  PLAZO_MAXIMO_EN_DIAS,
  PLAZO_MINIMO_EN_DIAS,
  type EstadoDeCuenta,
} from "./dominio/condiciones";
export {
  crearRepositorioDeCuentasDeClientes,
  type RepositorioDeCuentasDeClientes,
} from "./persistencia/repositorio-de-cuentas";
export {
  crearRepositoriosDeCuentaCorriente,
  type RepositoriosDeCuentaCorriente,
} from "./persistencia/repositorios-de-cuenta-corriente";
export { ERRORES_DE_CUENTA_CORRIENTE_POR_RESTRICCION } from "./persistencia/errores-por-restriccion";
export type { CuentaDelClienteDb } from "./persistencia/esquema";
export type { TxDeCuentaCorriente } from "./casos-de-uso/contrato";
export type { CuentaPublica } from "./casos-de-uso/cuenta-publica";
export {
  crearCasosDeUsoDeCuentaCorriente,
  type CasosDeUsoDeCuentaCorriente,
} from "./casos-de-uso/casos-de-uso";
export { disponibleDe, type DisponibleDeLaCuenta } from "./consultas/disponible";
export {
  crearConsultasDeCuentaCorriente,
  type ConsultasDeCuentaCorriente,
} from "./consultas/consultas";
export type { TxDeConsultasDeCuentaCorriente } from "./consultas/ver-cuenta";
export { DECLARACIONES as DECLARACIONES_DE_CUENTA_CORRIENTE } from "./casos-de-uso/declaraciones";
export { DECLARACIONES_DE_CONSULTAS as DECLARACIONES_DE_CONSULTAS_DE_CUENTA_CORRIENTE } from "./consultas/declaraciones";
export {
  anularCargoDeVentaEnTx,
  anularCobranzaDeVentaEnTx,
  cargarVentaEnTx,
  cobrarVentaEnTx,
  type CargoDeVentaRegistrado,
  type EntradaDelCargoDeVenta,
  type ErrorDelCargoDeVenta,
  type TxDeCargoDeVenta,
} from "./casos-de-uso/cargar-venta";
