/**
 * Entrada pública del módulo de listas del sistema (ADR-001; e3 §3.7, decisión 130): el dominio puro y el repositorio de plataforma
 * de `valor_de_lista`. Los casos de uso son de plataforma (`src/plataforma`): una empresa no administra las listas, solo las lee (el
 * cobro, por `caja`).
 */
export {
  LARGO_MAXIMO_DEL_NOMBRE_DE_VALOR,
  LISTAS_DEL_SISTEMA,
  decidirActivo,
  decidirNuevoNombre,
  listaDesdeTexto,
  nombreDeValorDesdeTexto,
  type CambioDecidido,
  type ErrorDeCambioDeValor,
  type ErrorDeListaInvalida,
  type ErrorDeNombreDeValor,
  type ListaDelSistema,
  type ValorDeLista,
} from "./dominio/valor-de-lista";
export {
  COLUMNAS_DE_VALOR_DE_LISTA,
  ERRORES_DE_LISTAS_POR_RESTRICCION,
  RESTRICCIONES_DE_DISPARADORES_DE_LISTAS,
  type ErrorDeListasPorRestriccion,
  type ListasDb,
} from "./persistencia/esquema";
export {
  crearRepositorioDeListas,
  type RepositorioDeListas,
  type ValorGuardado,
} from "./persistencia/repositorio-de-listas";
export { errorDeListasDeRestriccion, traducirErroresDeListas } from "./persistencia/traducir";
