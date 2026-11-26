import type { Respuesta } from "../capacidades/experiencia/respuesta";
import { CODIGOS_PUBLICOS, errorDeCodigo } from "../capacidades/experiencia/respuesta";
import { codigoDeJornada } from "../capacidades/experiencia/respuesta-de-cierre";
import type { CodigoDeVentas } from "../capacidades/experiencia/respuesta-de-ventas";
import { err, type Resultado } from "../primitivas/resultado/resultado";
import { aRespuesta, aRespuestaDeExcepcion, type DependenciasDeRespuesta } from "./a-respuesta";
import type { ErrorDeEntrada } from "./entradas-de-facturacion";

/**
 * De un error de ventas o del catálogo visto desde el mostrador al código público que sale a la pantalla (ADR-016). Lista de permitidos: solo pasan SIN CAMBIOS lo que ya tiene su
 * texto aprobado (los motivos del guard y los códigos públicos, `EMPRESA_NO_OPERA`) y los fallos de la base (`tipo`: salen como inesperados, con referencia; nunca disfrazados de «no
 * permitido»). TODO lo demás que el negocio rechaza (producto oculto o inexistente, opciones incompletas, cantidad que no es múltiplo del paso, precio sin cargar, sucursal ajena,
 * un id mal formado…) sale como el genérico «Esta acción no está permitida» (dueño, 30/10/2026, «Interfaz sobria»): ningún texto específico del mostrador está aprobado todavía
 * (`textos-mostrador-pendientes.md` §2, P5 y P9), salvo el día en cierre o cerrado (`JORNADA_EN_AUDITORIA`, `JORNADA_CERRADA`), que tienen sus dos avisos aprobados (CD-4). Un error nuevo del dominio cae solo en el genérico: cierra, no se filtra crudo. Previene: que un error de ventas salga crudo a la
 * pantalla o que se invente un texto por cada regla. Chequeo: `errores-de-ventas.test.ts`.
 */

const GENERICO: CodigoDeVentas = "VENTAS_ACCION_NO_PERMITIDA";

/** Un defecto de la base que el módulo no supo traducir: no es de negocio y sale como inesperado. */
const DEFECTO_DE_LA_BASE = "ERROR_DE_LA_BASE_NO_TRADUCIDO";

const esObjeto = (x: unknown): x is Readonly<Record<string, unknown>> =>
  typeof x === "object" && x !== null;

/** El error de una consulta o caso de uso tal como lo entiende `aRespuesta`. */
export function traducirErrorDeVentas(error: unknown): unknown {
  // Con el día en cierre o cerrado: los dos avisos aprobados (CD-4), no el genérico.
  const delDia = codigoDeJornada(error);
  if (delDia !== null) return { codigo: delDia };
  // Una venta a cuenta de $0 tiene su texto propio aprobado por el dueño (26/11/2026, DEC-VEN-003): no cae en el genérico.
  if (error === "VENTA_A_CERO_A_CUENTA")
    return { codigo: "VENTAS_VENTA_A_CERO_A_CUENTA" satisfies CodigoDeVentas };
  if (typeof error === "string") {
    return Object.hasOwn(CODIGOS_PUBLICOS, error) || error === DEFECTO_DE_LA_BASE
      ? error
      : { codigo: GENERICO };
  }
  if (esObjeto(error)) {
    // Un código público con forma de objeto (`EMPRESA_NO_OPERA { empresaId, motivo }`) y los fallos de la base (`tipo`) pasan; un error de negocio con nombre (`error`), no.
    if (typeof error["codigo"] === "string" && Object.hasOwn(CODIGOS_PUBLICOS, error["codigo"]))
      return error;
    if (typeof error["tipo"] === "string") return error;
    if (typeof error["error"] === "string") return { codigo: GENERICO };
  }
  return error;
}

/** El error genérico de ventas ya como respuesta (un pedido sin la forma pedida, o sin sucursal con la que trabajar). */
export const respuestaGenericaDeVentas = (): Respuesta<never> => ({
  ok: false,
  error: errorDeCodigo(GENERICO),
});

/**
 * Lo que tienen en común las acciones de la web del mostrador: leer el pedido, correr la consulta con el contexto del servidor y traducir el resultado. Un pedido sin la forma pedida es el
 * genérico; una excepción sale sin detalle y con referencia. Un solo lugar, igual que `accionDeCaja`.
 */
export async function accionDeVentas<E, S, D>(
  respuesta: DependenciasDeRespuesta,
  crudo: unknown,
  leer: (crudo: unknown) => Resultado<E, ErrorDeEntrada>,
  correr: (entrada: E) => Promise<Resultado<S, unknown>>,
  presentar: (salida: S) => D,
): Promise<Respuesta<D>> {
  const entrada = leer(crudo);
  if (!entrada.ok) return respuestaGenericaDeVentas();
  try {
    const resultado = await correr(entrada.valor);
    return aRespuesta(
      resultado.ok ? resultado : err(traducirErrorDeVentas(resultado.error)),
      respuesta,
      presentar,
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, respuesta);
  }
}
