/** Entrada pública del módulo de marcas (ADR-001): dominio puro de la marca comercial y sus versiones. */
export { normalizarHost, type ErrorDeHost, type Host } from "./dominio/host";
export {
  ASPECTO_POR_DEFECTO,
  ESQUINAS_DE_ASPECTO,
  ESTILOS_DE_ASPECTO,
  INGRESOS_DE_ASPECTO,
  LISTAS_DE_ASPECTO,
  SUPERFICIES_DE_ASPECTO,
  TITULOS_DE_ASPECTO,
  TOKENS_DE_ASPECTO,
  completarAspecto,
  esTokenDeAspecto,
  validarAspecto,
  type Aspecto,
  type AspectoCompleto,
  type ErrorDeAspecto,
  type EsquinasDeAspecto,
  type EstiloDeAspecto,
  type IngresoDeAspecto,
  type SuperficieDeAspecto,
  type TitulosDeAspecto,
  type TokenDeAspecto,
} from "./dominio/aspecto";
export {
  COLORES_DE_SUPERFICIE,
  COLOR_DEL_TEMA,
  CONTRASTE_MINIMO_DEL_ACENTO,
  CONTRASTE_MINIMO_DEL_TEXTO,
  TOKENS_DE_TEMA,
  contrasteSuficiente,
  contrastesDelTema,
  esTokenDeTema,
  luminanciaRelativa,
  parDeContrasteInsuficiente,
  razonDeContraste,
  validarTema,
  type ContrasteDeUnPar,
  type ErrorDeTema,
  type ParDeContraste,
  type Tema,
  type TemaCompleto,
  type TokenDeTema,
} from "./dominio/tema";
export {
  DEFINICION_VACIA,
  completarDefinicion,
  resolverDefinicion,
  validarLogo,
  validarModulosIniciales,
  validarNombreVisible,
  type CampoFaltante,
  type DefinicionCompleta,
  type DefinicionDeMarca,
  type DefinicionResuelta,
  type ErrorDeModuloInicial,
} from "./dominio/definicion";
export {
  resolverConOrigen,
  type DefinicionConOrigen,
  type OrigenEnLaCadena,
  type OrigenesDeLaDefinicion,
} from "./dominio/efectiva";
export {
  NIVEL_MAXIMO_DE_LA_BASE,
  campoInmutableModificado,
  decidirAltaDeMarca,
  nivelDeMarca,
  validarCodigoDeMarca,
  type CampoInmutable,
  type DatosInmutablesDeMarca,
  type ErrorDeAltaDeMarca,
  type MarcaPorCrear,
  type NivelDeMarca,
  type PadreDeMarca,
} from "./dominio/jerarquia";
export {
  TOLERANCIA_DE_RELOJ_EN_MS,
  estadosDeVigencia,
  hayProgramadaPendiente,
  versionVigente,
  type EstadoDeVigencia,
  type VersionConVigencia,
} from "./dominio/vigencia";
export {
  decidirConfirmacionDeMarca,
  decidirGuardadoDeBorrador,
  definicionDeLaUltimaDecision,
  validarCambiosDeBorrador,
  type BorradorGuardado,
  type CambiosDeBorrador,
  type CambiosValidadosDeBorrador,
  type ConfirmacionDeMarca,
  type DecisionDeBorrador,
  type ErrorDeConfirmacion,
  type ErrorDeFormaDeBorrador,
  type PedidoDeConfirmacion,
  type PlanPorDefecto,
} from "./dominio/version";

// M4a: gestión de dominios (alta y ciclo de vida) y su persistencia.
export {
  ESTADOS_DE_DOMINIO,
  LARGO_MAXIMO_DEL_MOTIVO_DE_RETIRO,
  SUPERFICIES_DE_DOMINIO,
  TITULARES_DE_DOMINIO,
  decidirAltaDeDominio,
  decidirCambioDeDominio,
  validarPedidoDeCambioDeDominio,
  type CambioDeEstadoDeDominio,
  type DecisionDeCambioDeDominio,
  type DominioActual,
  type DominioPorAgregar,
  type DuenioDeDominio,
  type ErrorDeAltaDeDominio,
  type ErrorDeCambioDeDominio,
  type EstadoDeDominio,
  type PedidoDeAltaDeDominio,
  type PedidoDeCambioDeDominio,
  type SuperficieDeDominio,
  type TitularDeDominio,
} from "./dominio/ciclo-de-dominio";
export {
  COLUMNAS_DE_DOMINIO,
  ERRORES_DE_DOMINIO_POR_RESTRICCION,
  ERRORES_DE_MARCAS_POR_RESTRICCION,
  RESTRICCIONES_DE_DISPARADORES_DE_DOMINIO,
  RESTRICCIONES_DE_DISPARADORES_DE_MARCAS,
  type ErrorDeDominioPorRestriccion,
  type ErrorDeMarcaPorRestriccion,
} from "./persistencia/esquema";
export {
  crearRepositorioDeDominios,
  type DominioGuardado,
  type RepositorioDeDominios,
} from "./persistencia/repositorios";
export type { DominiosDb, MarcasParaMailDb, PublicoDb } from "./persistencia/tablas";
export {
  errorDeDominioDeRestriccion,
  errorDeMarcaDeRestriccion,
  traducirErroresDeDominio,
  traducirErroresDeMarca,
} from "./persistencia/traducir";

// M4: resolución pública de hosts y marca de los mails (solo lecturas).
export {
  decidirMarcaDeMail,
  type DatosDeMarcaParaMail,
  type MarcaDeMailDecidida,
  type RespaldoDeMail,
} from "./dominio/marca-de-mail";
export {
  decidirConfiguracionPublica,
  type ConfiguracionPublica,
  type DatosParaLaConfiguracionPublica,
  type VersionPublicaDeMarca,
} from "./dominio/configuracion-publica";
export {
  crearLecturaDeMarcaParaMail,
  crearLecturaPublicaDeMarcas,
  type HostServible,
  type LecturaDeMarcaParaMail,
  type LecturaPublicaDeMarcas,
} from "./persistencia/lecturas";

// M5: escritura de marcas y de sus versiones por los casos de uso de plataforma.
export { COLUMNAS_DE_MARCA, COLUMNAS_DE_VERSION_DE_MARCA } from "./persistencia/esquema";
export {
  crearRepositorioDeMarcas,
  type ConfirmacionPorEscribir,
  type EstadoDeMarca,
  type MarcaGuardada,
  type RepositorioDeMarcas,
  type VersionConfirmadaDeMarca,
  type VersionDeMarcaGuardada,
} from "./persistencia/repositorio-de-marcas";
export type { MarcasDb } from "./persistencia/tablas";

// M6: lo que el alta de una empresa lee de la marca (solo lectura, con la conexión de plataforma).
export {
  crearLecturaDeMarcaParaElAlta,
  type DatosDeMarcaParaElAlta,
  type LecturaDeMarcaParaElAlta,
  type LecturaParaElAltaDb,
} from "./persistencia/lectura-para-el-alta";
