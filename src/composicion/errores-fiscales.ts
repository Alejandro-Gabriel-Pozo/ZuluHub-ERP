import { categoriaDeCodigo } from "../adaptadores/arca/errores-de-arca";
import type { CodigoFiscal } from "../capacidades/experiencia/respuesta-fiscal";
import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ClaveDeTexto } from "../capacidades/vocabulario/catalogo";
import type { MotivoDeRechazo } from "../capacidades/permisos/guard";
import type { EmpresaNoOpera } from "../contexto/estados";
import type {
  ErrorAlCambiarAmbiente,
  ErrorAlDescartarComprobante,
  ErrorAlEmitir,
  ErrorAlListarComprobantes,
  ErrorAlReintentarComprobante,
  ErrorAlResincronizarSerie,
  ErrorAlVerComprobante,
  MensajeDeIntento,
} from "../modulos/fiscal/publico";
import { err, type Resultado } from "../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../puertos/transacciones";
import { aRespuesta, type DependenciasDeRespuesta } from "./a-respuesta";

/**
 * El traductor de los errores del facturador a la forma pública (ADR-016): de lo que devuelven los casos de uso y
 * las consultas de fiscal a lo ÚNICO que sale hacia la pantalla. Se apoya en `aRespuesta`, que ya resuelve lo
 * común (el motivo del guard, la empresa que no opera, lo inesperado con su referencia `PD-…`); acá solo se
 * agrega lo propio de fiscal: cada error de negocio del módulo pasa a un código público `FISCAL_*` con su texto en
 * castellano neutro.
 *
 * Lo que garantiza, con su chequeo en `errores-fiscales.test.ts`:
 *  - **Exhaustivo por tipo.** Las tablas son `Record` sobre la unión de los errores de los casos de uso y las
 *    consultas: un error nuevo del módulo que nadie tradujo NO COMPILA. Previene: que aparezca crudo (o como un
 *    genérico que esconde qué corregir) en la pantalla el día que alguien suma un error.
 *  - **Nada interno sale.** Un error de persistencia (restricción, SQLSTATE, conflicto de concurrencia), un error que
 *    la tabla marca como defecto (`null`) o uno que no se reconoce salen como `ERROR_INTERNO` con su referencia, y el
 *    detalle solo va al registro del servidor.
 *  - **Nada de otra empresa.** Un comprobante «de otra empresa» (que la base ya no deja ver) se dice igual que uno
 *    que no existe: sin oráculo de qué hay en otra empresa.
 *  - **`SIN_PERMISO` y los demás motivos del guard pasan tal cual** (`aRespuesta` los reconoce): la pantalla oculta la
 *    acción por su código.
 */

/** Los errores de negocio de fiscal que la web puede recibir (sin los que `aRespuesta` ya sabe tratar). */
type ErrorDeNegocioFiscal = Exclude<
  | ErrorAlEmitir
  | ErrorAlDescartarComprobante
  | ErrorAlReintentarComprobante
  | ErrorAlResincronizarSerie
  | ErrorAlCambiarAmbiente
  | ErrorAlListarComprobantes
  | ErrorAlVerComprobante,
  MotivoDeRechazo | EmpresaNoOpera | ErrorDePersistencia
>;

type ErrorTextual = Extract<ErrorDeNegocioFiscal, string>;
type ErrorConCodigo = Extract<ErrorDeNegocioFiscal, Readonly<{ codigo: string }>>;

/**
 * Cada error que viene como texto: su código público, o `null` si es un defecto del servidor (la persona no puede
 * hacer nada: sale como error inesperado con referencia). Los de la lista de criterios del listado salen todos como
 * `FISCAL_FILTRO_INVALIDO`, y `CAMPO_DE_CRITERIO` dice cuál.
 */
export const FISCAL_POR_ERROR_DE_TEXTO: Readonly<Record<ErrorTextual, CodigoFiscal | null>> = {
  CLAVE_INVALIDA: "FISCAL_PEDIDO_SIN_IDENTIFICAR",
  CLAVE_REUTILIZADA: "FISCAL_PEDIDO_REPETIDO",
  PUNTO_DE_VENTA_NO_ENCONTRADO: "FISCAL_PUNTO_DE_VENTA_NO_ENCONTRADO",
  PUNTO_DE_VENTA_INACTIVO: "FISCAL_PUNTO_DE_VENTA_INACTIVO",
  EMISOR_INACTIVO: "FISCAL_EMISOR_INACTIVO",
  SIN_DATOS_FISCALES_VIGENTES: "FISCAL_SIN_DATOS_FISCALES",
  SIN_CERTIFICADO_VIGENTE: "FISCAL_SIN_CERTIFICADO",
  COMPROBANTE_ASOCIADO_NO_ENCONTRADO: "FISCAL_COMPROBANTE_NO_ENCONTRADO",
  // La base rechazó el alta o el asociado por una restricción: la persona no pudo evitarlo, es un defecto.
  COMPROBANTE_ALTA_INVALIDA: null,
  COMPROBANTE_ASOCIADO_INVALIDO: null,
  COMPROBANTE_NO_ENCONTRADO: "FISCAL_COMPROBANTE_NO_ENCONTRADO",
  COMPROBANTE_YA_ENVIADO: "FISCAL_COMPROBANTE_YA_ENVIADO",
  ESTADO_NO_DESCARTABLE: "FISCAL_ESTADO_NO_DESCARTABLE",
  VERSION_DESACTUALIZADA: "FISCAL_VERSION_DESACTUALIZADA",
  MOTIVO_DE_DESCARTE_INVALIDO: "FISCAL_MOTIVO_INVALIDO",
  MOTIVO_INVALIDO: "FISCAL_MOTIVO_INVALIDO",
  SERIE_BLOQUEADA: "FISCAL_SERIE_BLOQUEADA",
  ESTADO_NO_REINTENTABLE: "FISCAL_ESTADO_NO_REINTENTABLE",
  SERIE_NO_ENCONTRADA: "FISCAL_SERIE_NO_ENCONTRADA",
  SERIE_NO_BLOQUEADA: "FISCAL_SERIE_NO_BLOQUEADA",
  ULTIMO_DISTINTO_DEL_DE_ARCA: "FISCAL_ULTIMO_DISTINTO_DEL_DE_ARCA",
  DESFASE_HACIA_ATRAS: "FISCAL_DESFASE_HACIA_ATRAS",
  SERIE_EN_CURSO: "FISCAL_SERIE_EN_CURSO",
  AMBIENTE_NO_VUELVE: "FISCAL_AMBIENTE_NO_VUELVE",
  PUNTO_DE_VENTA_YA_EMITIO_EN_PRODUCCION: "FISCAL_YA_EMITIO_EN_PRODUCCION",
  LIMITE_INVALIDO: "FISCAL_FILTRO_INVALIDO",
  TEXTO_DEMASIADO_LARGO: "FISCAL_FILTRO_INVALIDO",
  FECHAS_INVERTIDAS: "FISCAL_FILTRO_INVALIDO",
  LETRA_INVALIDA: "FISCAL_FILTRO_INVALIDO",
  PUNTO_DE_VENTA_INVALIDO: "FISCAL_FILTRO_INVALIDO",
  ORIGEN_TIPO_INVALIDO: "FISCAL_FILTRO_INVALIDO",
  ORIGEN_ID_INVALIDO: "FISCAL_FILTRO_INVALIDO",
  ORIGEN_ID_SIN_TIPO: "FISCAL_FILTRO_INVALIDO",
  CLAVE_DE_PAGINA_INVALIDA: "FISCAL_FILTRO_INVALIDO",
};

/** El campo del listado al que apunta cada criterio inválido (el nombre que usa el pedido, no uno interno). */
const CAMPO_DE_CRITERIO: Readonly<Partial<Record<ErrorTextual, string>>> = {
  LIMITE_INVALIDO: "limite",
  TEXTO_DEMASIADO_LARGO: "texto",
  FECHAS_INVERTIDAS: "hasta",
  LETRA_INVALIDA: "letra",
  PUNTO_DE_VENTA_INVALIDO: "puntoDeVenta",
  ORIGEN_TIPO_INVALIDO: "origenTipo",
  ORIGEN_ID_INVALIDO: "origenId",
  ORIGEN_ID_SIN_TIPO: "origenTipo",
  CLAVE_DE_PAGINA_INVALIDA: "despuesDe",
};

/**
 * Cada error que viene como objeto con `codigo` (los del dominio de un comprobante nuevo, y los del servicio de
 * ARCA al resincronizar). `ASOCIADO_DE_OTRA_EMPRESA` se dice como un comprobante que no existe.
 */
export const FISCAL_POR_ERROR_CON_CODIGO: Readonly<Record<ErrorConCodigo["codigo"], CodigoFiscal>> =
  {
    RECEPTOR_INVALIDO: "FISCAL_RECEPTOR_INVALIDO",
    RECEPTOR_INVALIDO_PARA_A: "FISCAL_RECEPTOR_INVALIDO_PARA_A",
    RECEPTOR_IGUAL_AL_EMISOR: "FISCAL_RECEPTOR_IGUAL_AL_EMISOR",
    RECEPTOR_NO_CATEGORIZADO_NO_SOPORTADO: "FISCAL_RECEPTOR_NO_CATEGORIZADO",
    SIN_RENGLONES: "FISCAL_SIN_RENGLONES",
    DEMASIADOS_RENGLONES: "FISCAL_DEMASIADOS_RENGLONES",
    RENGLON_INVALIDO: "FISCAL_RENGLON_INVALIDO",
    ALICUOTA_EN_LETRA_C: "FISCAL_ALICUOTA_EN_LETRA_C",
    FALTA_ALICUOTA: "FISCAL_FALTA_ALICUOTA",
    MODO_DE_PRECIO_INVALIDO_PARA_C: "FISCAL_MODO_DE_PRECIO_INVALIDO_PARA_C",
    FECHAS_DE_SERVICIO_INVALIDAS: "FISCAL_FECHAS_DE_SERVICIO_INVALIDAS",
    TOTAL_FUERA_DE_RANGO: "FISCAL_TOTAL_FUERA_DE_RANGO",
    ASOCIADO_NO_AUTORIZADO: "FISCAL_ASOCIADO_NO_AUTORIZADO",
    ASOCIADO_DE_OTRA_EMPRESA: "FISCAL_COMPROBANTE_NO_ENCONTRADO",
    ASOCIADO_DE_OTRO_EMISOR: "FISCAL_ASOCIADO_DE_OTRO_EMISOR",
    ASOCIADO_DE_OTRO_AMBIENTE: "FISCAL_ASOCIADO_DE_OTRO_AMBIENTE",
    ASOCIADO_NO_ASOCIABLE: "FISCAL_ASOCIADO_NO_ASOCIABLE",
    MOTIVO_INVALIDO: "FISCAL_MOTIVO_INVALIDO",
    SERVICIO_NO_DISPONIBLE: "FISCAL_ARCA_NO_DISPONIBLE",
    SIN_CREDENCIAL: "FISCAL_ARCA_CERTIFICADO_NO_SIRVE",
    AUTORIZACION_DEL_SERVICIO_FALTANTE: "FISCAL_ARCA_SERVICIO_NO_AUTORIZADO",
    ACCESO_YA_EMITIDO: "FISCAL_ARCA_ACCESO_EN_CURSO",
  };

const esObjeto = (x: unknown): x is Readonly<Record<string, unknown>> =>
  typeof x === "object" && x !== null;

/** Una posición base cero se muestra base uno (`renglon1`): el campo es un nombre de formulario, nunca texto libre. */
const campoDeRenglon = (posicion: unknown, campo: string): string | undefined =>
  typeof posicion === "number" && Number.isInteger(posicion) && posicion >= 0
    ? `renglon${posicion + 1}.${campo}`
    : undefined;

function campoDeError(error: Readonly<Record<string, unknown>>): string | undefined {
  switch (error["codigo"]) {
    case "RECEPTOR_INVALIDO":
      return typeof error["campo"] === "string" ? `receptor.${error["campo"]}` : "receptor";
    case "RENGLON_INVALIDO":
      return typeof error["campo"] === "string"
        ? campoDeRenglon(error["posicion"], error["campo"])
        : undefined;
    case "ALICUOTA_EN_LETRA_C":
    case "FALTA_ALICUOTA":
      return campoDeRenglon(error["posicion"], "alicuota");
    case "MOTIVO_INVALIDO":
      return "motivo";
    default:
      return undefined;
  }
}

/**
 * El error tal como lo entiende `aRespuesta`: un error de negocio de fiscal pasa a `{ codigo: FISCAL_*, campo? }`, y
 * todo lo demás (el motivo del guard, la empresa que no opera, un error de persistencia, un defecto o algo que no
 * se conoce) pasa SIN CAMBIOS, para que `aRespuesta` lo trate como siempre (los primeros dos con su texto, el resto
 * como inesperado, con referencia y sin detalle).
 */
export function traducirErrorFiscal(error: unknown): unknown {
  if (typeof error === "string") {
    if (!Object.hasOwn(FISCAL_POR_ERROR_DE_TEXTO, error)) return error;
    const codigo = FISCAL_POR_ERROR_DE_TEXTO[error as ErrorTextual];
    if (codigo === null) return error;
    const campo =
      CAMPO_DE_CRITERIO[error as ErrorTextual] ??
      (codigo === "FISCAL_MOTIVO_INVALIDO" ? "motivo" : undefined);
    return campo === undefined ? { codigo } : { codigo, campo };
  }
  if (esObjeto(error) && typeof error["codigo"] === "string") {
    if (!Object.hasOwn(FISCAL_POR_ERROR_CON_CODIGO, error["codigo"])) return error;
    const codigo = FISCAL_POR_ERROR_CON_CODIGO[error["codigo"] as ErrorConCodigo["codigo"]];
    const campo = campoDeError(error);
    return campo === undefined ? { codigo } : { codigo, campo };
  }
  return error;
}

/**
 * El resultado de un caso de uso o una consulta de fiscal, listo para la pantalla: `aRespuesta` con el error ya
 * traducido. `presentar` arma el dato que sale (solo lo que la pantalla necesita).
 */
export function aRespuestaFiscal<T, E, D>(
  resultado: Resultado<T, E>,
  dependencias: DependenciasDeRespuesta,
  presentar: (valor: T) => D,
): Respuesta<D> {
  return aRespuesta(
    resultado.ok ? resultado : err(traducirErrorFiscal(resultado.error)),
    dependencias,
    presentar,
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Lo que ARCA contestó de un comprobante, en palabras del negocio
// ---------------------------------------------------------------------------------------------------------------

/**
 * Los códigos de ARCA que el módulo ya conoce por su spec (H7 facturación §B.3 y §B.5.4, WSFE v4.8) y su texto. El
 * resto se dice por su categoría (`categoriaDeCodigo`) o, si es un rechazo cualquiera, con un texto general y el
 * código, que es lo que el contador o soporte necesitan para buscarlo.
 */
const TEXTO_DE_CODIGO_DE_ARCA: Readonly<Record<number, ClaveDeTexto>> = {
  10005: "fiscal.arca.punto_de_venta_no_habilitado",
  10013: "fiscal.arca.receptor_para_a",
  10015: "fiscal.arca.receptor_sin_identificar",
  10048: "fiscal.arca.importes_no_cierran",
  10067: "fiscal.arca.receptor_no_categorizado",
  10069: "fiscal.arca.receptor_igual_al_emisor",
  10197: "fiscal.arca.nota_sin_asociado",
  10237: "fiscal.arca.nota_mayor_que_el_comprobante",
  10242: "fiscal.arca.condicion_iva_del_receptor",
  10243: "fiscal.arca.condicion_iva_del_receptor",
  10246: "fiscal.arca.condicion_iva_obligatoria",
  10283: "fiscal.arca.receptor_no_categorizado",
};

/** Un mensaje de ARCA para la pantalla: el texto es una clave del catálogo, nunca el que mandó ARCA. */
export type MensajeDeArcaParaLaPantalla = Readonly<{
  clase: MensajeDeIntento["clase"];
  /** El código de ARCA (número público de su manual): sirve para consultar al contador o a soporte. */
  codigo: number;
  clave: ClaveDeTexto;
  /** Solo los textos generales llevan el código como marcador `{codigo}`. */
  marcadores?: Readonly<{ codigo: string }>;
}>;

const GENERICO_POR_CLASE: Readonly<Record<MensajeDeIntento["clase"], ClaveDeTexto>> = {
  ERROR: "fiscal.arca.error_generico",
  OBSERVACION: "fiscal.arca.observacion_generica",
  EVENTO: "fiscal.arca.evento_generico",
};

const CLAVE_DE_CATEGORIA: Readonly<
  Record<ReturnType<typeof categoriaDeCodigo>, ClaveDeTexto | null>
> = {
  TOKEN: "fiscal.arca.autorizacion",
  INFRAESTRUCTURA: "fiscal.arca.problema_interno",
  SIN_DATOS: "fiscal.arca.sin_datos",
  FUERA_DE_SECUENCIA: "fiscal.arca.fuera_de_secuencia",
  RECHAZO: null,
};

/**
 * Traduce un mensaje de ARCA (código y texto crudo) a su texto del negocio. El texto crudo NO se usa nunca: podría
 * traer datos del comprobante, rutas de ARCA o cualquier cosa que ARCA decida escribir.
 */
export function traducirMensajeDeArca(mensaje: MensajeDeIntento): MensajeDeArcaParaLaPantalla {
  const { clase, codigo } = mensaje;
  const propio = Object.hasOwn(TEXTO_DE_CODIGO_DE_ARCA, codigo)
    ? TEXTO_DE_CODIGO_DE_ARCA[codigo]
    : undefined;
  const clave =
    propio ?? CLAVE_DE_CATEGORIA[categoriaDeCodigo(codigo)] ?? GENERICO_POR_CLASE[clase];
  const general = Object.values(GENERICO_POR_CLASE).includes(clave);
  return general
    ? { clase, codigo, clave, marcadores: { codigo: String(codigo) } }
    : { clase, codigo, clave };
}
