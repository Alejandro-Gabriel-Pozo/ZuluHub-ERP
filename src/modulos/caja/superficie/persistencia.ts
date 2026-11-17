/** La persistencia de caja que sale por `publico.ts` (los repositorios y el esquema que arma la composición). */
export { COLUMNAS_DE_CAJA, type CajaDb } from "../persistencia/esquema";
export { ERRORES_DE_CAJA_POR_RESTRICCION } from "../persistencia/errores-por-restriccion";
export {
  crearRepositorioDeCajas,
  type OpcionesDeListadoDeCajas,
  type RepositorioDeCajas,
} from "../persistencia/repositorio-de-cajas";
export {
  crearRepositorioDeMediosDePago,
  type CambiosPersistidosDeMedio,
  type OpcionesDeListadoDeMedios,
  type RepositorioDeMediosDePago,
} from "../persistencia/repositorio-de-medios";
export {
  crearRepositorioDeCuentasDeCobro,
  type CambiosPersistidosDeCuenta,
  type NuevaCuentaDeCobro,
  type OpcionesDeListadoDeCuentas,
  type RepositorioDeCuentasDeCobro,
} from "../persistencia/repositorio-de-cuentas";
export {
  crearRepositorioDeSesiones,
  type FiltroDeSesiones,
  type RepositorioDeSesiones,
  type SesionGuardada,
  type SesionNueva,
} from "../persistencia/repositorio-de-sesiones";
export {
  crearRepositorioDeMovimientos,
  type CursorDeMovimientos,
  type EsperadoDeLinea,
  type MovimientoConSesion,
  type MovimientoDeLista,
  type MovimientoGuardado,
  type MovimientoNuevo,
  type MovimientoParaSumar,
  type RepositorioDeMovimientos,
} from "../persistencia/repositorio-de-movimientos";
export {
  crearRepositorioDeCobros,
  type RepositorioDeCobros,
} from "../persistencia/repositorio-de-cobros";
export {
  crearRepositorioDeArqueos,
  type ArqueoGuardado,
  type LineaDeArqueoGuardada,
  type RepositorioDeArqueos,
} from "../persistencia/repositorio-de-arqueos";
export {
  crearRepositorioDeCorrecciones,
  type CobroACorregir,
  type CorreccionDeLaJornada,
  type CorreccionNueva,
  type CorreccionPorClave,
  type RepositorioDeCorrecciones,
} from "../persistencia/repositorio-de-correcciones";
export {
  crearRepositorioDeDeclaraciones,
  type ConformeGuardado,
  type ConformeNuevo,
  type DeclaracionDeLaJornada,
  type DeclaracionNueva,
  type DeclaracionPorClave,
  type RepositorioDeDeclaraciones,
} from "../persistencia/repositorio-de-declaraciones";
export {
  crearRepositorioDeLaJornada,
  type AjusteConEnlace,
  type ArqueoDeLaJornada,
  type CobradoDeUnOrigenEnLaJornada,
  type CobradoPorMedioVigente,
  type CursorDeOrigenes,
  type MovimientoManualDeLaJornada,
  type RepositorioDeLaJornada,
} from "../persistencia/repositorio-de-la-jornada";
export {
  crearRepositorioDeCobrosDeLaJornada,
  type CobroDeLaJornada,
  type CorreccionDeUnCobro,
  type CursorDeCobros,
  type FiltroDeCobros,
  type RepositorioDeCobrosDeLaJornada,
} from "../persistencia/repositorio-de-cobros-de-la-jornada";
export type { MedioYCuentaConNombre } from "../persistencia/base-de-la-jornada";
export {
  crearRepositorioDeFotos,
  type FotoDeCaja,
  type LineaDeFoto,
  type LineaGuardada,
  type OrigenDeFoto,
  type OrigenGuardado,
  type RepositorioDeFotos,
} from "../persistencia/repositorio-de-fotos";
