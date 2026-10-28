import type { EmpresaNoOpera } from "../../contexto/estados";
import type { MotivoDeRechazo } from "../permisos/guard";
import type { ClaveDeTexto } from "../vocabulario/catalogo";
import { CLAVES_DE_ERRORES_FISCALES, type CodigoFiscal } from "./respuesta-fiscal";

/**
 * El núcleo PURO del traductor único de respuestas (ADR-016): de cualquier resultado de un caso de uso, una
 * consulta o una excepción, lo ÚNICO que sale hacia la pantalla. Decide solo el QUÉ (qué código público es,
 * con qué texto y con qué presentación); la referencia `PD-…` y el registro del servidor son del borde
 * (`src/composicion/a-respuesta.ts`), que le pasa el azar y el registro como datos.
 *
 * Garantías (cada una con su prueba):
 *  - Un error inesperado, una excepción, `ConcurrenciaAgotada` o cualquier cosa que no se conoce sale SOLO
 *    como `ERROR_INTERNO` (o `NO_DISPONIBLE` si se pidió) con su referencia: el detalle (mensaje de la base,
 *    nombre de una restricción, pila) va al registro y NUNCA a la respuesta.
 *  - Un código de negocio o un motivo del guard sale con su código estable y la clave de su texto; los datos
 *    del error (ids de empresa, por ejemplo) no salen.
 *  - Todo código público tiene su clave de texto: `Record<CodigoPublico, …>` no compila si falta una, y los
 *    motivos del guard (`MotivoDeRechazo`) son parte de la unión, así que sumar un motivo obliga a sumarlo acá.
 */

/** Cómo se muestra el error (cada una es un patrón de la interfaz, [01] §6.3). */
export type Presentacion = "AVISO" | "POR_QUE_NO_PUEDO" | "SESION" | "INESPERADO";

/** Códigos de negocio que una pantalla de sesión y empresa puede recibir. Cada flujo nuevo suma los suyos. */
export type CodigoDeNegocio =
  | "INVITACION_NO_ENCONTRADA"
  | "INVITACION_REVOCADA"
  | "INVITACION_NO_PENDIENTE"
  | "INVITACION_VENCIDA"
  | "INVITACION_DE_OTRO_EMAIL"
  | "ALTA_NO_PENDIENTE"
  | "PERSONA_SUSPENDIDA"
  | "PERSONA_DE_OTRO_USUARIO"
  | "USUARIO_DE_OTRA_PERSONA"
  | "YA_ES_MIEMBRO"
  | "ROL_DISTINTO_AL_ANTERIOR"
  | "EMPRESA_NO_OPERA"
  | CodigoFiscal;

export type CodigoPublico =
  CodigoDeNegocio | MotivoDeRechazo | "SESION_VENCIDA" | "ERROR_INTERNO" | "NO_DISPONIBLE";

type DefinicionDeCodigo = Readonly<{
  clave: ClaveDeTexto;
  presentacion: Presentacion;
  /** Para las rutas (route handlers) que responden con estado HTTP. */
  estadoHttp: 401 | 403 | 422 | 500 | 503;
}>;

const aviso = (clave: ClaveDeTexto): DefinicionDeCodigo => ({
  clave,
  presentacion: "AVISO",
  estadoHttp: 422,
});
const motivo = (clave: ClaveDeTexto, estadoHttp: 403 | 422 = 403): DefinicionDeCodigo => ({
  clave,
  presentacion: "POR_QUE_NO_PUEDO",
  estadoHttp,
});

/** Los códigos del facturador (`respuesta-fiscal.ts`): cada uno es un aviso con su texto `error.<código>`. */
const AVISOS_FISCALES = Object.fromEntries(
  Object.entries(CLAVES_DE_ERRORES_FISCALES).map(([codigo, clave]) => [codigo, aviso(clave)]),
) as Readonly<Record<CodigoFiscal, DefinicionDeCodigo>>;

/** La tabla de los códigos públicos: código estable → clave del texto, presentación y estado HTTP. */
export const CODIGOS_PUBLICOS: Readonly<Record<CodigoPublico, DefinicionDeCodigo>> = Object.freeze({
  INVITACION_NO_ENCONTRADA: aviso("error.invitacion_no_encontrada"),
  INVITACION_REVOCADA: aviso("error.invitacion_revocada"),
  INVITACION_NO_PENDIENTE: aviso("error.invitacion_no_pendiente"),
  INVITACION_VENCIDA: aviso("error.invitacion_vencida"),
  INVITACION_DE_OTRO_EMAIL: aviso("error.invitacion_de_otro_email"),
  ALTA_NO_PENDIENTE: aviso("error.alta_no_pendiente"),
  PERSONA_SUSPENDIDA: aviso("error.persona_suspendida"),
  PERSONA_DE_OTRO_USUARIO: aviso("error.persona_de_otro_usuario"),
  USUARIO_DE_OTRA_PERSONA: aviso("error.usuario_de_otra_persona"),
  YA_ES_MIEMBRO: aviso("error.ya_es_miembro"),
  ROL_DISTINTO_AL_ANTERIOR: aviso("error.rol_distinto_al_anterior"),
  EMPRESA_NO_OPERA: motivo("error.empresa_no_opera", 422),
  ...AVISOS_FISCALES,
  MODULO_EN_DESARROLLO: motivo("motivo.modulo_en_desarrollo"),
  MODULO_NO_ACTIVO: motivo("motivo.modulo_no_activo"),
  MODULO_EN_SOLO_LECTURA: motivo("motivo.modulo_en_solo_lectura"),
  SIN_CAPACIDAD: motivo("motivo.sin_capacidad"),
  SIN_PERMISO: motivo("motivo.sin_permiso"),
  SESION_VENCIDA: { clave: "error.sesion_vencida", presentacion: "SESION", estadoHttp: 401 },
  ERROR_INTERNO: { clave: "error.inesperado", presentacion: "INESPERADO", estadoHttp: 500 },
  NO_DISPONIBLE: { clave: "error.no_disponible", presentacion: "INESPERADO", estadoHttp: 503 },
});

/** El texto del estado de una empresa que no opera (`motivo.empresa.<estado>`), por el motivo que dio el dominio. */
const CLAVE_DE_EMPRESA_QUE_NO_OPERA: Readonly<Record<EmpresaNoOpera["motivo"], ClaveDeTexto>> =
  Object.freeze({
    EMPRESA_EN_ALTA: "motivo.empresa.empresa_en_alta",
    EMPRESA_SUSPENDIDA: "motivo.empresa.empresa_suspendida",
    EMPRESA_CANCELADA: "motivo.empresa.empresa_cancelada",
    EMPRESA_EN_BAJA: "motivo.empresa.empresa_en_baja",
    TENANT_SUSPENDIDO: "motivo.empresa.tenant_suspendido",
  });

/** Lo que sale hacia la pantalla cuando algo no salió bien. Solo datos públicos: nada interno. */
export type ErrorPublico = Readonly<{
  codigo: CodigoPublico;
  /** La clave del texto a mostrar (`texto(diccionario, clave)`): la marca cambia la redacción, no el código. */
  clave: ClaveDeTexto;
  presentacion: Presentacion;
  /** El campo del formulario al que se asocia el error, si el error lo trae y tiene la forma de un campo. */
  campo?: string;
  /** `PD-…`: solo en los errores inesperados. Con ella soporte encuentra el registro del servidor. */
  referencia?: string;
}>;

export type Respuesta<T> =
  Readonly<{ ok: true; dato: T }> | Readonly<{ ok: false; error: ErrorPublico }>;

/** Un campo es un nombre corto de formulario (`email`, `empresa.cuit`): nunca un texto libre. */
const FORMA_DE_CAMPO = /^[a-z][A-Za-z0-9_]{0,63}(\.[a-z][A-Za-z0-9_]{0,63}){0,3}$/;

export type Clasificado =
  | Readonly<{ tipo: "PUBLICO"; codigo: CodigoPublico; campo?: string; clave?: ClaveDeTexto }>
  | Readonly<{ tipo: "INESPERADO"; detalle: string }>;

const esObjeto = (x: unknown): x is Readonly<Record<string, unknown>> =>
  typeof x === "object" && x !== null;

const esCodigoPublico = (x: unknown): x is CodigoPublico =>
  typeof x === "string" && Object.hasOwn(CODIGOS_PUBLICOS, x);

/** El detalle de un fallo para el REGISTRO del servidor. Nunca llega a una respuesta. */
export function detalleDeFalla(falla: unknown): string {
  if (falla instanceof Error) return `${falla.name}: ${falla.message}`;
  if (esObjeto(falla) && typeof falla["tipo"] === "string") {
    const partes = ["restriccion", "sqlstate", "mensaje"]
      .map((campo) => falla[campo])
      .filter((v): v is string => typeof v === "string");
    return [falla["tipo"], ...partes].join(" ");
  }
  return typeof falla === "string" ? falla : "falla sin descripción";
}

/**
 * Qué es lo que salió: un código público conocido (de negocio, motivo del guard, sesión vencida) o algo
 * inesperado. Lo que no se reconoce es inesperado: ante la duda, sin detalle y con referencia.
 */
export function clasificarError(error: unknown): Clasificado {
  // Un código de negocio o un motivo del guard viene como texto.
  if (esCodigoPublico(error)) return { tipo: "PUBLICO", codigo: error };
  // O como objeto con `codigo` (`EMPRESA_NO_OPERA { empresaId, motivo }`): solo el código y, si lo hay, el campo.
  if (esObjeto(error) && esCodigoPublico(error["codigo"])) {
    const campo = error["campo"];
    const conCampo =
      typeof campo === "string" && FORMA_DE_CAMPO.test(campo) ? { campo } : ({} as const);
    const estado = error["motivo"];
    const claveDeEstado =
      error["codigo"] === "EMPRESA_NO_OPERA" &&
      typeof estado === "string" &&
      Object.hasOwn(CLAVE_DE_EMPRESA_QUE_NO_OPERA, estado)
        ? CLAVE_DE_EMPRESA_QUE_NO_OPERA[estado as EmpresaNoOpera["motivo"]]
        : undefined;
    return {
      tipo: "PUBLICO",
      codigo: error["codigo"],
      ...conCampo,
      ...(claveDeEstado === undefined ? {} : { clave: claveDeEstado }),
    };
  }
  return { tipo: "INESPERADO", detalle: detalleDeFalla(error) };
}

/** El error público de un código clasificado (con su campo y su texto propio, si los trae; sin referencia). */
export function errorPublicoDe(
  clasificado: Extract<Clasificado, { tipo: "PUBLICO" }>,
): ErrorPublico {
  const base = errorDeCodigo(clasificado.codigo);
  return {
    ...base,
    clave: clasificado.clave ?? base.clave,
    ...(clasificado.campo === undefined ? {} : { campo: clasificado.campo }),
  };
}

/** El error público de un fallo inesperado: solo el código genérico y la referencia. */
export function errorInesperado(referencia: string, indisponible: boolean): ErrorPublico {
  return { ...errorDeCodigo(indisponible ? "NO_DISPONIBLE" : "ERROR_INTERNO"), referencia };
}

/** El estado HTTP de un código público, para las rutas que responden con él. */
export function estadoHttpDe(codigo: CodigoPublico): number {
  return CODIGOS_PUBLICOS[codigo].estadoHttp;
}

/** El error público de un código conocido, tal cual (sin campo, sin referencia): «sin permiso», «sesión vencida»… */
export function errorDeCodigo(codigo: CodigoPublico): ErrorPublico {
  const definicion = CODIGOS_PUBLICOS[codigo];
  return { codigo, clave: definicion.clave, presentacion: definicion.presentacion };
}
