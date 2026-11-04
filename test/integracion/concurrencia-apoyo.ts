import type { Resultado } from "../../src/primitivas/resultado/resultado";
import { crearBarrera } from "./entorno";

/**
 * Apoyo común de las pruebas de concurrencia: la regla «quien pierde una carrera puede recibir `ConcurrenciaAgotada`».
 *
 * Por qué existe: el motor de transacciones es SERIALIZABLE con 6 reintentos y devuelve el error tipado
 * `ConcurrenciaAgotada` si pierde 7 veces seguidas; el servidor revierte y reintentar con la misma clave es seguro. Es
 * una respuesta legítima, no un defecto. Esa regla estaba reescrita a mano en 12 archivos (4 predicados distintos y
 * topes de 1, 20, 50 y 200): cada copia podía aflojarse sola, y una aceptaba al perdedor sin exigir que alguien ganara
 * (una regresión donde nadie gana quedaba en verde). El chequeo de que esto sigue así es `concurrencia-apoyo.test.ts`.
 */

type Cualquiera = Resultado<unknown, unknown>;

/**
 * Tope de reintentos de `reintentarSiAgotada`. El motor hace hasta ~0,6 s de espera por cada `ConcurrenciaAgotada`,
 * así que 50 reintentos son ~30 s como mucho: sobra para una carga pasajera (es el mayor tope por reintento que ya había
 * en el repositorio, el de la preparación de `facturacion-consultas`, puesto tras verla fallar cuatro veces; los otros
 * eran 1 y 20) y un error persistente disfrazado de «carga» igual corta antes de los 60 s de las pruebas de integración
 * (`topes.ts`).
 */
const TOPE_DE_REINTENTOS = 50;

/** La única forma de reconocer el error de agotamiento: el error tipado del adaptador (`{ tipo: "ConcurrenciaAgotada" }`). */
export function esConcurrenciaAgotada(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "tipo" in error &&
    error.tipo === "ConcurrenciaAgotada"
  );
}

/** El código de un resultado: `ok`, el propio error si es texto, su `tipo` si es un objeto tipado, o `otro`. */
export function codigoDe(r: Cualquiera): string {
  if (r.ok) return "ok";
  if (typeof r.error === "string") return r.error;
  const tipo = (r.error as { tipo?: unknown } | null)?.tipo;
  return typeof tipo === "string" ? tipo : "otro";
}

const comoTexto = (valor: unknown): string =>
  JSON.stringify(valor, (_, v: unknown) => (typeof v === "bigint" ? v.toString() : v)) ??
  String(valor);

const con = (contexto: string | undefined, mensaje: string): string =>
  contexto === undefined ? mensaje : `${contexto}: ${mensaje}`;

/**
 * `n` llamadas a la vez (cada una recibe su índice). Con `fijarBarrera`, mientras corren queda puesta una barrera de
 * `n` participantes (la variable del archivo que las transacciones esperan) y al terminar, o fallar, se quita.
 */
export async function correrEnParalelo<T>(
  n: number,
  llamada: (i: number) => Promise<T>,
  fijarBarrera?: (barrera: (() => Promise<void>) | null) => void,
): Promise<T[]> {
  fijarBarrera?.(crearBarrera(n));
  try {
    return await Promise.all(Array.from({ length: n }, (_, i) => llamada(i)));
  } finally {
    fijarBarrera?.(null);
  }
}

/**
 * La carrera la pueden perder varios, y el que pierde puede recibir `ConcurrenciaAgotada`, pero ALGUIEN gana.
 * Falla si nadie ganó (todos agotados o con error de negocio: una regresión donde nadie gana no puede pasar en
 * verde) o si algún perdedor trae un error que no es de agotamiento ni uno de los `esperados` (códigos de negocio,
 * como `YA_HAY_BORRADOR`), mostrando el error real. No limita cuántos ganan: eso es del invariante de cada prueba.
 * Devuelve cuántos ganaron y cuántos agotaron.
 */
export function perdedorAceptable(
  resultados: readonly Cualquiera[],
  opciones: { readonly esperados: readonly string[]; readonly contexto?: string },
): { readonly ganadores: number; readonly agotadas: number } {
  const { esperados, contexto } = opciones;
  if (resultados.length === 0) throw new Error(con(contexto, "no hubo ningún resultado que mirar"));
  let ganadores = 0;
  let agotadas = 0;
  for (const r of resultados) {
    if (r.ok) ganadores += 1;
    else if (esConcurrenciaAgotada(r.error)) agotadas += 1;
    else if (!esperados.includes(codigoDe(r))) {
      throw new Error(
        con(
          contexto,
          `el perdedor trae ${codigoDe(r)} y solo se aceptan [${esperados.join(", ")}] o ConcurrenciaAgotada (error real: ${comoTexto(r.error)})`,
        ),
      );
    }
  }
  if (ganadores === 0) {
    throw new Error(
      con(
        contexto,
        `nadie ganó la carrera (${agotadas} de ${resultados.length} agotaron los reintentos): [${resultados.map(codigoDe).join(", ")}]`,
      ),
    );
  }
  return { ganadores, agotadas };
}

/**
 * Repite `trabajo` (con la MISMA entrada: es el mismo cierre, seguro por su clave) SOLO ante `ConcurrenciaAgotada`,
 * hasta `tope` reintentos. Devuelve el valor del éxito. Ante cualquier otro error falla mostrando el error real, y si
 * el agotamiento persiste, falla diciéndolo: un error persistente no queda disfrazado de «carga».
 */
export async function reintentarSiAgotada<T, E>(
  trabajo: () => Promise<Resultado<T, E>>,
  opciones: { readonly tope?: number; readonly contexto?: string } = {},
): Promise<T> {
  const tope = opciones.tope ?? TOPE_DE_REINTENTOS;
  for (let reintento = 0; ; reintento++) {
    const r = await trabajo();
    if (r.ok) return r.valor;
    if (!esConcurrenciaAgotada(r.error)) {
      throw new Error(con(opciones.contexto, `falló: ${comoTexto(r.error)}`));
    }
    if (reintento >= tope) {
      throw new Error(
        con(opciones.contexto, `ConcurrenciaAgotada persistió tras ${tope} reintentos seguidos`),
      );
    }
  }
}
