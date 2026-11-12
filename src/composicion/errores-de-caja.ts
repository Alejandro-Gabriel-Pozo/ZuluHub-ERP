import type { Respuesta } from "../capacidades/experiencia/respuesta";
import { errorDeCodigo } from "../capacidades/experiencia/respuesta";
import type { CodigoDeCaja } from "../capacidades/experiencia/respuesta-de-caja";
import type { MotivoDeRechazo } from "../capacidades/permisos/guard";
import type {
  ErrorAlCrearMedioDePago,
  ErrorAlDesactivarMedioDePago,
  ErrorAlEditarMedioDePago,
  ErrorAlReactivarMedioDePago,
} from "../modulos/caja/publico";
import { err, type Resultado } from "../primitivas/resultado/resultado";
import { aRespuesta, aRespuestaDeExcepcion, type DependenciasDeRespuesta } from "./a-respuesta";
import type { ErrorDeEntrada } from "./entradas-de-facturacion";

/**
 * De un error de la configuración de caja (medios de pago) al código público que sale a la pantalla (ADR-016). Dos respuestas, solo las que la maqueta
 * aprobada del 09/11/2026 tiene con texto: «Ya existe un medio con ese nombre» para el nombre repetido (también si el que lo tiene está desactivado: sigue
 * existiendo) y el genérico «Esta acción no está permitida» para todo lo demás que el dominio rechaza (el tipo o el nombre inválidos, el efectivo que no se
 * desactiva ni se repite, el medio que no existe, la versión vieja, un dato que el medio no admite). El guard, la empresa que no opera y la base ya traen su
 * propio código y pasan SIN CAMBIOS. Es exhaustiva por tipo: un error nuevo del dominio no compila hasta que se le dé su código.
 * Previene: que un error de caja salga crudo a la pantalla o que se invente un texto por cada regla del dominio.
 */

type ErrorDeMedio =
  | ErrorAlCrearMedioDePago
  | ErrorAlEditarMedioDePago
  | ErrorAlDesactivarMedioDePago
  | ErrorAlReactivarMedioDePago;

/** Los errores del dominio que son un texto propio de caja (los motivos del guard y los códigos de otros módulos tienen el suyo). */
type ErrorPropioDeMedio = Exclude<Extract<ErrorDeMedio, string>, MotivoDeRechazo>;

const CODIGO_DE_ERROR_PROPIO: Readonly<Record<ErrorPropioDeMedio, CodigoDeCaja>> = {
  MEDIO_DUPLICADO: "CAJA_MEDIO_REPETIDO",
  MEDIO_INACTIVO_CON_ESE_NOMBRE: "CAJA_MEDIO_REPETIDO",
  TIPO_DE_MEDIO_INVALIDO: "CAJA_ACCION_NO_PERMITIDA",
  NOMBRE_DE_MEDIO_INVALIDO: "CAJA_ACCION_NO_PERMITIDA",
  EFECTIVO_YA_EXISTE: "CAJA_ACCION_NO_PERMITIDA",
  EFECTIVO_NO_SE_DESACTIVA: "CAJA_ACCION_NO_PERMITIDA",
  MEDIO_NO_ENCONTRADO: "CAJA_ACCION_NO_PERMITIDA",
  VERSION_DESACTUALIZADA: "CAJA_ACCION_NO_PERMITIDA",
};

const CODIGO_DEL_DATO_NO_ADMITIDO = "DATO_NO_ADMITIDO_POR_EL_MEDIO";

/** El error del caso de uso tal como lo entiende `aRespuesta`: un código público de caja o, si no es de caja, el mismo error. */
export function traducirErrorDeCaja(error: unknown): unknown {
  if (typeof error === "string" && Object.hasOwn(CODIGO_DE_ERROR_PROPIO, error)) {
    return { codigo: CODIGO_DE_ERROR_PROPIO[error as ErrorPropioDeMedio] };
  }
  if (
    typeof error === "object" &&
    error !== null &&
    (error as { codigo?: unknown }).codigo === CODIGO_DEL_DATO_NO_ADMITIDO
  ) {
    return { codigo: "CAJA_ACCION_NO_PERMITIDA" satisfies CodigoDeCaja };
  }
  return error;
}

/**
 * Lo que tienen en común las acciones de la web de la configuración de caja: leer el pedido, correr el caso de uso o la consulta con el contexto del
 * servidor y traducir el resultado. Un pedido sin la forma pedida es el genérico (no hay un texto por campo en la maqueta); una excepción sale sin detalle
 * y con referencia. Un solo lugar: que cada pantalla de caja no lo escriba a su manera.
 */
export async function accionDeCaja<E, S, D>(
  respuesta: DependenciasDeRespuesta,
  crudo: unknown,
  leer: (crudo: unknown) => Resultado<E, ErrorDeEntrada>,
  correr: (entrada: E) => Promise<Resultado<S, unknown>>,
  presentar: (salida: S) => D,
): Promise<Respuesta<D>> {
  const entrada = leer(crudo);
  if (!entrada.ok) return { ok: false, error: errorDeCodigo("CAJA_ACCION_NO_PERMITIDA") };
  try {
    const resultado = await correr(entrada.valor);
    return aRespuesta(
      resultado.ok ? resultado : err(traducirErrorDeCaja(resultado.error)),
      respuesta,
      presentar,
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, respuesta);
  }
}
