import { categoriaDeCodigo } from "../adaptadores/arca/errores-de-arca";
import type { CodigoFiscal } from "../capacidades/experiencia/respuesta-fiscal";
import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ClaveDeTexto } from "../capacidades/vocabulario/catalogo";
import type { MotivoDeRechazo } from "../capacidades/permisos/guard";
import type { EmpresaNoOpera } from "../contexto/estados";
import type {
  ErrorAlActivarPuntoDeVenta,
  ErrorAlCambiarAmbiente,
  ErrorAlConfirmarDatosFiscales,
  ErrorAlCrearPuntoDeVenta,
  ErrorAlDescartarComprobante,
  ErrorAlDesactivarPuntoDeVenta,
  ErrorAlEditarPuntoDeVenta,
  ErrorAlEmitir,
  ErrorAlGuardarElBorrador,
  ErrorAlListarComprobantes,
  ErrorAlReintentarComprobante,
  ErrorAlResincronizarSerie,
  ErrorAlVerComprobante,
  MensajeDeIntento,
  CasosDeUsoDeConfiguracionFiscal,
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

// `publico.ts` de fiscal no puede crecer (deuda registrada): el tipo de error de «empezar corrección» sale del caso de uso.
type ErrorAlEmpezarLaCorreccion = Extract<
  Awaited<ReturnType<CasosDeUsoDeConfiguracionFiscal["empezarCorreccionDeDatosFiscales"]>>,
  Readonly<{ ok: false }>
>["error"];

/** Los errores de negocio de fiscal que la web puede recibir (sin los que `aRespuesta` ya sabe tratar). */
type ErrorDeNegocioFiscal = Exclude<
  | ErrorAlEmitir
  | ErrorAlDescartarComprobante
  | ErrorAlReintentarComprobante
  | ErrorAlResincronizarSerie
  | ErrorAlCambiarAmbiente
  | ErrorAlListarComprobantes
  | ErrorAlVerComprobante
  // La configuración fiscal (D-43): datos fiscales, puntos de venta y las consultas de esas pantallas (`EMISOR_NO_ENCONTRADO`).
  | ErrorAlGuardarElBorrador
  | ErrorAlEmpezarLaCorreccion
  | ErrorAlConfirmarDatosFiscales
  | ErrorAlCrearPuntoDeVenta
  | ErrorAlEditarPuntoDeVenta
  | ErrorAlActivarPuntoDeVenta
  | ErrorAlDesactivarPuntoDeVenta,
  MotivoDeRechazo | EmpresaNoOpera | ErrorDePersistencia
>;

/**
 * Un error de negocio de la configuración fiscal que NO tiene todavía un texto aprobado por el dueño (la regla del repositorio:
 * sin fuente verificable no se agrega un texto). Hasta que lo tenga sale como un error inesperado, con su referencia `PD-…`, y el
 * código queda en el registro del servidor (soporte lo ve ahí). Sumarle su código público es: una línea acá, su clave en
 * `respuesta-fiscal.ts` y su texto en el catálogo. Previene: inventar el cartel que ve el cliente por un error que no se decidió.
 */
const SIN_TEXTO_APROBADO = "SIN_TEXTO_APROBADO";

type ErrorTextual = Extract<ErrorDeNegocioFiscal, string>;
type ErrorConCodigo = Extract<ErrorDeNegocioFiscal, Readonly<{ codigo: string }>>;

/**
 * Cada error que viene como texto: su código público, o `null` si es un defecto del servidor (la persona no puede
 * hacer nada: sale como error inesperado con referencia). Los de la lista de criterios del listado salen todos como
 * `FISCAL_FILTRO_INVALIDO`, y `CAMPO_DE_CRITERIO` dice cuál.
 */
export const FISCAL_POR_ERROR_DE_TEXTO: Readonly<
  Record<ErrorTextual, CodigoFiscal | typeof SIN_TEXTO_APROBADO | null>
> = {
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
  // La sucursal del listado (D-18): sin elegir la pantalla hace elegir; una que no es de su alcance se dice como tal.
  SUCURSAL_NO_ELEGIDA: "FISCAL_SUCURSAL_NO_ELEGIDA",
  SUCURSAL_FUERA_DE_ALCANCE: "FISCAL_SUCURSAL_FUERA_DE_ALCANCE",
  // Emitir (D-41, D-51 y D-50): la sucursal del punto de venta no es de la persona, o está cerrada. (La de la factura que corrige una nota no
  // llega acá: da «comprobante no encontrado», decisión del dueño, 29/10/2026 (D-56).)
  SUCURSAL_CERRADA: "FISCAL_SUCURSAL_CERRADA",
  // Datos fiscales y puntos de venta (D-43): lo que la persona escribió mal sale como `FISCAL_CONFIGURACION_DATOS_INVALIDOS` con el campo
  // (el formulario lo marca). Su texto, «Revisá los datos marcados.», es el de D-67 y reemplaza acá al «Revise los datos del comprobante»,
  // que es de las facturas (`FISCAL_DATOS_INVALIDOS`). Un identificador de la pantalla mal armado es «no se pudo identificar el
  // pedido». D-45: los de Ingresos Brutos no los puede provocar nadie (el pedido no los trae), y la base no deja un número de versión
  // repetido: defectos.
  RAZON_SOCIAL_INVALIDA: "FISCAL_CONFIGURACION_DATOS_INVALIDOS",
  CONDICION_IVA_INVALIDA: "FISCAL_CONFIGURACION_DATOS_INVALIDOS",
  INICIO_DE_ACTIVIDADES_INVALIDO: "FISCAL_CONFIGURACION_DATOS_INVALIDOS",
  IIBB_NUMERO_INVALIDO: null,
  IIBB_CONDICION_INVALIDA: null,
  NUMERO_DE_VERSION_INVALIDO: null,
  MOTIVO_OBLIGATORIO: "FISCAL_MOTIVO_INVALIDO",
  VIGENCIA_RETROACTIVA: "FISCAL_CONFIGURACION_DATOS_INVALIDOS",
  INSTANTE_INVALIDO: "FISCAL_CONFIGURACION_DATOS_INVALIDOS",
  CALLE_INVALIDA: "FISCAL_CONFIGURACION_DATOS_INVALIDOS",
  NUMERO_INVALIDO: "FISCAL_CONFIGURACION_DATOS_INVALIDOS",
  PISO_INVALIDO: "FISCAL_CONFIGURACION_DATOS_INVALIDOS",
  DEPARTAMENTO_INVALIDO: "FISCAL_CONFIGURACION_DATOS_INVALIDOS",
  LOCALIDAD_INVALIDA: "FISCAL_CONFIGURACION_DATOS_INVALIDOS",
  PROVINCIA_INVALIDA: "FISCAL_CONFIGURACION_DATOS_INVALIDOS",
  CODIGO_POSTAL_INVALIDO: "FISCAL_CONFIGURACION_DATOS_INVALIDOS",
  PUNTO_DE_VENTA_NUMERO_INVALIDO: "FISCAL_CONFIGURACION_DATOS_INVALIDOS",
  ID_INVALIDO: "FISCAL_PEDIDO_SIN_IDENTIFICAR",
  // Puntos de venta (D-66, confirmada por el dueño el 2026-10-29): sus tres textos aprobados.
  PUNTO_DE_VENTA_DUPLICADO: "FISCAL_PUNTO_DE_VENTA_DUPLICADO",
  PUNTO_DE_VENTA_NUMERO_INMUTABLE: "FISCAL_PUNTO_DE_VENTA_NUMERO_INMUTABLE",
  PUNTO_DE_VENTA_SIN_DOMICILIO: "FISCAL_PUNTO_DE_VENTA_SIN_DOMICILIO",
  // D-68 (`Pedernal-docs/11-especificaciones/facturador-contratos-de-pantalla.md`, confirmada por el dueño el 2026-10-29: «Sí me cierra»):
  // el borrador de datos fiscales es del emisor, no de la pestaña, y una pantalla con datos viejos recibe «versión desactualizada» (texto ya
  // aprobado: `error.fiscal_version_desactualizada`, sin texto nuevo). `YA_HAY_BORRADOR` (otra pestaña creó el borrador mientras esta
  // pantalla seguía sin él) sale así; la pantalla se actualiza y abre el borrador que existe.
  YA_HAY_BORRADOR: "FISCAL_VERSION_DESACTUALIZADA",
  // Decisión del ingeniero, misma fuente (D-68) y mismo texto aprobado: guardar sobre el `borradorId` de una versión que otra pantalla ya
  // confirmó es, para la persona, la misma situación (su pantalla tenía datos viejos). Actualiza y ve lo vigente.
  VERSION_CONFIRMADA_INMUTABLE: "FISCAL_VERSION_DESACTUALIZADA",
  // Sin texto aprobado, y así debe seguir: en el uso normal no ocurren (la pantalla solo ofrece ids que existen y son de la empresa), así
  // que si pasan es un defecto o un pedido armado a mano y salen como error inesperado con su referencia `PD-…`.
  EMISOR_NO_ENCONTRADO: SIN_TEXTO_APROBADO,
  DATOS_FISCALES_NO_ENCONTRADOS: SIN_TEXTO_APROBADO,
  DOMICILIO_NO_ENCONTRADO: SIN_TEXTO_APROBADO,
  ID_EN_USO: SIN_TEXTO_APROBADO,
  // La pantalla solo ofrece las sucursales de la empresa: un id ajeno es un pedido armado a mano, y decir que existe en otra
  // empresa sería un oráculo. La base lo rechaza por la referencia, no por una regla que la persona pueda corregir.
  SUCURSAL_DE_OTRA_EMPRESA: null,
};

/** Los códigos de la configuración fiscal que todavía salen sin texto propio: lo que hay que preguntarle al dueño. */
export const CODIGOS_DE_CONFIGURACION_SIN_TEXTO: readonly string[] = Object.entries(
  FISCAL_POR_ERROR_DE_TEXTO,
)
  .filter(([, codigo]) => codigo === SIN_TEXTO_APROBADO)
  .map(([error]) => error);

/** El campo del formulario al que apunta cada error de dato (el nombre que usa el pedido, no uno interno). */
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
  RAZON_SOCIAL_INVALIDA: "razonSocial",
  CONDICION_IVA_INVALIDA: "condicionIva",
  INICIO_DE_ACTIVIDADES_INVALIDO: "inicioActividades",
  VIGENCIA_RETROACTIVA: "vigenteDesde",
  INSTANTE_INVALIDO: "vigenteDesde",
  CALLE_INVALIDA: "domicilio.calle",
  NUMERO_INVALIDO: "domicilio.numero",
  PISO_INVALIDO: "domicilio.piso",
  DEPARTAMENTO_INVALIDO: "domicilio.departamento",
  LOCALIDAD_INVALIDA: "domicilio.localidad",
  PROVINCIA_INVALIDA: "domicilio.provincia",
  CODIGO_POSTAL_INVALIDO: "domicilio.codigoPostal",
  PUNTO_DE_VENTA_NUMERO_INVALIDO: "numero",
  // D-66 (los tres mensajes al cargar un punto de venta): el campo que la pantalla marca, sin texto nuevo. Decisión del ingeniero: D-66 aprueba
  // los textos y no dice dónde se marcan; se marca el campo del que habla cada mensaje.
  PUNTO_DE_VENTA_DUPLICADO: "numero",
  PUNTO_DE_VENTA_NUMERO_INMUTABLE: "numero",
  PUNTO_DE_VENTA_SIN_DOMICILIO: "domicilio",
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
    // Confirmar datos fiscales incompletos: el campo es el primero que falta (D-43: «validación de campos obligatorios»); el texto es el
    // de Datos fiscales (D-67), no el de las facturas.
    DATOS_FISCALES_INCOMPLETOS: "FISCAL_CONFIGURACION_DATOS_INVALIDOS",
  };

/** El campo del formulario de cada dato obligatorio de los datos fiscales (el domicilio es un bloque entero). */
const CAMPO_DE_OBLIGATORIO: Readonly<Record<string, string>> = {
  razonSocial: "razonSocial",
  condicionIva: "condicionIva",
  domicilioFiscalId: "domicilio",
  inicioActividades: "inicioActividades",
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
    case "DATOS_FISCALES_INCOMPLETOS": {
      const primero: unknown = Array.isArray(error["faltantes"])
        ? error["faltantes"][0]
        : undefined;
      return typeof primero === "string" ? (CAMPO_DE_OBLIGATORIO[primero] ?? undefined) : undefined;
    }
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
    if (codigo === null || codigo === SIN_TEXTO_APROBADO) return error;
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
