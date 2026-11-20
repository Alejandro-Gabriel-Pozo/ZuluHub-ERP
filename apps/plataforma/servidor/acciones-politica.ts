import "server-only";

import { detalleDeFalla } from "../../../src/capacidades/experiencia/respuesta";
import { errorDePolitica } from "../logica/errores-de-politica";
import { entradaDeDefinirPolitica } from "../logica/politica-de-plan";
import type { RespuestaDeConsola } from "../logica/respuesta-de-consola";
import { exigirAcceso } from "./acceso";
import { esRedireccion, fallaInesperada, type Falla } from "./proteccion";

const ETIQUETA = "politica-de-plan";
const DATOS_NO_VALIDOS = "Los datos no son válidos. Revisalos.";

/** El error de un caso de uso para el navegador; lo inesperado va al registro con su referencia y sin datos del pedido. */
function falla(error: unknown): Falla {
  const paraLaPantalla = errorDePolitica(error);
  if (paraLaPantalla.tipo === "INESPERADO") return fallaInesperada(ETIQUETA, detalleDeFalla(error));
  return { ok: false, error: paraLaPantalla };
}

/**
 * Definir una versión nueva de la política de cambio de plan (solo ADMIN con segundo factor reciente: lo exige el caso de uso, no esta acción). La entrada viene del navegador: se valida la forma
 * y el resto lo decide el caso de uso. La clave de idempotencia la fija el navegador (una por intento); `versionEsperada` evita pisar lo que definió otra persona.
 */
export async function definirPoliticaDeConsola(
  entrada: unknown,
): Promise<RespuestaDeConsola<{ version: number }>> {
  const forma = entradaDeDefinirPolitica(entrada);
  if (!forma.ok) return { ok: false, error: { tipo: "GENERAL", texto: DATOS_NO_VALIDOS } };
  try {
    const acceso = await exigirAcceso();
    const r = await acceso.casos.definirPoliticaDeCambioDePlan(forma.valor);
    return r.ok ? { ok: true, dato: { version: r.valor.version } } : falla(r.error);
  } catch (excepcion) {
    if (esRedireccion(excepcion)) throw excepcion;
    return fallaInesperada(ETIQUETA, detalleDeFalla(excepcion));
  }
}
