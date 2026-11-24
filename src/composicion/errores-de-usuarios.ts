import { errorDeCodigo, type Respuesta } from "../capacidades/experiencia/respuesta";
import type { CodigoDeUsuarios } from "../capacidades/experiencia/respuesta-de-usuarios";
import type { Resultado } from "../primitivas/resultado/resultado";
import { err } from "../primitivas/resultado/resultado";
import { aRespuesta, aRespuestaDeExcepcion, type DependenciasDeRespuesta } from "./a-respuesta";
import type { ErrorDeEntrada } from "./entradas-de-facturacion";

/**
 * De un error de la pantalla «Usuarios» al código público que sale a la pantalla (ADR-016). Todo error de NEGOCIO (los motivos del guard, la persona que no está en
 * la empresa, cualquier texto de error) sale como el genérico «Esta acción no está permitida» (dueño, 30/10/2026, interfaz sobria; maqueta `usuarios.html` del 23/11/2026),
 * sin decir cuál fue: una persona de otra empresa y una inexistente dan lo mismo. Los errores de la base (objetos, no textos) pasan SIN CAMBIOS: `aRespuesta` los vuelve
 * un fallo inesperado con referencia `PD-…` y el detalle va al registro del servidor, nunca a la pantalla.
 * Previene: que un motivo del guard con su texto propio, un error sin traducir o el detalle de la base lleguen al navegador. Chequeo: `errores-de-usuarios.test.ts`.
 */

const GENERICO = { codigo: "USUARIOS_NO_PERMITIDO" satisfies CodigoDeUsuarios } as const;

/** El error de la consulta tal como lo entiende `aRespuesta`: un texto de negocio es el genérico; un error de la base sigue como está. */
export function traducirErrorDeUsuarios(error: unknown): unknown {
  return typeof error === "string" ? GENERICO : error;
}

/**
 * Lo que tienen en común las lecturas de la web de Usuarios: leer el pedido, correr la consulta con el contexto del servidor y traducir el resultado. Un pedido sin la forma
 * pedida es el genérico; una excepción sale sin detalle y con referencia. Un solo lugar: que cada pantalla de Usuarios no lo escriba a su manera.
 */
export async function accionDeUsuarios<E, S, D>(
  respuesta: DependenciasDeRespuesta,
  crudo: unknown,
  leer: (crudo: unknown) => Resultado<E, ErrorDeEntrada>,
  correr: (entrada: E) => Promise<Resultado<S, unknown>>,
  presentar: (salida: S) => D,
): Promise<Respuesta<D>> {
  const entrada = leer(crudo);
  if (!entrada.ok) return { ok: false, error: errorDeCodigo("USUARIOS_NO_PERMITIDO") };
  return lecturaDeUsuarios(respuesta, () => correr(entrada.valor), presentar);
}

/** Una lectura sin pedido que leer (la lista): corre la consulta y traduce el resultado o la excepción. */
export async function lecturaDeUsuarios<S, D>(
  respuesta: DependenciasDeRespuesta,
  correr: () => Promise<Resultado<S, unknown>>,
  presentar: (salida: S) => D,
): Promise<Respuesta<D>> {
  try {
    const resultado = await correr();
    return aRespuesta(
      resultado.ok ? resultado : err(traducirErrorDeUsuarios(resultado.error)),
      respuesta,
      presentar,
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, respuesta);
  }
}
