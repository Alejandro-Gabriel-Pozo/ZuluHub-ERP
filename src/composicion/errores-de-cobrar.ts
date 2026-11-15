import {
  errorDeCodigo,
  clasificarError,
  type Respuesta,
} from "../capacidades/experiencia/respuesta";
import type { CodigoDeCaja } from "../capacidades/experiencia/respuesta-de-caja";
import { err, type Resultado } from "../primitivas/resultado/resultado";
import { aRespuesta, aRespuestaDeExcepcion, type DependenciasDeRespuesta } from "./a-respuesta";
import type { ErrorDeEntrada } from "./entradas-de-facturacion";

/**
 * De un error de cobrar o anular en el mostrador al código público que sale a la pantalla (ADR-016). Regla del dueño (2026-10-30, «mensaje genérico antes
 * que uno por acción»): hoy NINGÚN error de negocio de cobrar tiene texto aprobado, así que todos salen como el genérico ya aprobado «Esta acción no está
 * permitida» (`CAJA_ACCION_NO_PERMITIDA`): el precio que cambió, el cobro que no cuadra, la caja sin sesión o en cierre, el ticket ya cobrado, un dato
 * del cobro mal escrito, la clave reutilizada con otro pedido, el ticket ya facturado… Tres cosas NO se vuelven genéricas, porque ya tienen su respuesta y
 * esconderlas empeoraría el diagnóstico: los motivos del guard y la empresa que no opera (código público propio) y lo inesperado de la base o del propio
 * módulo (`INVARIANTE_DE_VENTAS`, `ERROR_DE_LA_BASE_NO_TRADUCIDO` y los `ErrorDePersistencia`), que salen con su referencia `PD-…` y el detalle al
 * registro. Falla cerrado: un error de ventas nuevo que no se nombró acá sale genérico, nunca crudo.
 * Textos específicos que la pantalla va a necesitar (PRECIO_CAMBIO con el total nuevo, COBRO_NO_CUADRA, SIN_SESION_ABIERTA…): preguntas pendientes
 * (ver el informe del PR); cuando se aprueben, se suman con su código y su fuente.
 * Previene: que un error de ventas o de caja salga crudo a la pantalla, o que se invente un texto por cada regla del dominio.
 */

const INESPERADOS_DEL_MODULO: ReadonlySet<string> = new Set([
  "INVARIANTE_DE_VENTAS",
  "ERROR_DE_LA_BASE_NO_TRADUCIDO",
]);

const TIPOS_DE_PERSISTENCIA: ReadonlySet<string> = new Set([
  "Unicidad",
  "Superposicion",
  "Referencia",
  "Check",
  "AccesoDenegado",
  "ConcurrenciaAgotada",
  "Inesperado",
]);

const GENERICO = { codigo: "CAJA_ACCION_NO_PERMITIDA" satisfies CodigoDeCaja } as const;

/** El error tal como lo entiende `aRespuesta`: lo ya público o inesperado pasa igual; el resto del negocio, el genérico. */
export function traducirErrorDeCobrar(error: unknown): unknown {
  if (clasificarError(error).tipo === "PUBLICO") return error;
  if (typeof error === "string" && INESPERADOS_DEL_MODULO.has(error)) return error;
  if (
    typeof error === "object" &&
    error !== null &&
    TIPOS_DE_PERSISTENCIA.has(String((error as { tipo?: unknown }).tipo))
  ) {
    return error;
  }
  return GENERICO;
}

/**
 * Lo que tienen en común las acciones de cobrar y anular: leer el pedido, correr el caso de uso o la consulta con el contexto del servidor y traducir el
 * resultado. Un pedido sin la forma pedida es el genérico (no hay un texto por campo); una excepción sale sin detalle y con referencia.
 */
export async function accionDeCobrar<E, S, D>(
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
      resultado.ok ? resultado : err(traducirErrorDeCobrar(resultado.error)),
      respuesta,
      presentar,
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, respuesta);
  }
}
