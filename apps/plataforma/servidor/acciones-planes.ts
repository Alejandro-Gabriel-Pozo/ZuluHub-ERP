import "server-only";

import { detalleDeFalla } from "../../../src/capacidades/experiencia/respuesta";
import { errorDePlanes } from "../logica/errores-de-planes";
import {
  entradaDeCrearPlan,
  entradaDeGuardarBorrador,
  entradaDePublicar,
} from "../logica/entrada-de-planes";
import type { RespuestaDeConsola } from "../logica/respuesta-de-consola";
import { exigirAcceso } from "./acceso";
import { esRedireccion, fallaInesperada, type Falla } from "./proteccion";

const ETIQUETA = "planes";
const DATOS_NO_VALIDOS = "Los datos no son válidos. Revisalos.";

const datosNoValidos = (): RespuestaDeConsola<never> => ({
  ok: false,
  error: { tipo: "GENERAL", texto: DATOS_NO_VALIDOS },
});

/** El error de un caso de uso para el navegador; lo inesperado va al registro con su referencia y sin datos del pedido. */
function falla(error: unknown): Falla {
  const paraLaPantalla = errorDePlanes(error);
  if (paraLaPantalla.tipo === "INESPERADO") return fallaInesperada(ETIQUETA, detalleDeFalla(error));
  return { ok: false, error: paraLaPantalla };
}

/** Corre una acción con el acceso de este pedido: una redirección (sin sesión) sigue su camino; lo que lance es «inesperado». */
async function protegida<D>(
  accion: (acceso: Awaited<ReturnType<typeof exigirAcceso>>) => Promise<RespuestaDeConsola<D>>,
): Promise<RespuestaDeConsola<D>> {
  try {
    return await accion(await exigirAcceso());
  } catch (excepcion) {
    if (esRedireccion(excepcion)) throw excepcion;
    return fallaInesperada(ETIQUETA, detalleDeFalla(excepcion));
  }
}

/**
 * Crear un plan (solo ADMIN, lo exige el caso de uso). La entrada viene del navegador: se valida la forma y el resto lo decide el caso de uso.
 * La clave de idempotencia la fija el navegador (una por intento); esta acción no genera claves.
 */
export async function crearPlanDeConsola(
  entrada: unknown,
): Promise<RespuestaDeConsola<{ planId: string; yaExistia: boolean }>> {
  const forma = entradaDeCrearPlan(entrada);
  if (!forma.ok) return datosNoValidos();
  return protegida(async (acceso) => {
    const r = await acceso.casos.crearPlan(forma.valor);
    return r.ok
      ? { ok: true, dato: { planId: r.valor.planId, yaExistia: r.valor.yaExistia } }
      : falla(r.error);
  });
}

/** Guardar el borrador de un plan (crea el borrador si no había). `versionEsperada` evita pisar lo que guardó otra persona. */
export async function guardarBorradorDeConsola(
  entrada: unknown,
): Promise<RespuestaDeConsola<{ borradorId: string; version: number }>> {
  const forma = entradaDeGuardarBorrador(entrada);
  if (!forma.ok) return datosNoValidos();
  return protegida(async (acceso) => {
    const r = await acceso.casos.guardarBorradorDePlan(forma.valor);
    return r.ok
      ? { ok: true, dato: { borradorId: r.valor.borradorId, version: r.valor.version } }
      : falla(r.error);
  });
}

/** Publicar el borrador del plan con su motivo. Pide el segundo factor reciente (lo exige el guard; la pantalla pide el código y repite con la misma clave). */
export async function publicarVersionDeConsola(
  entrada: unknown,
): Promise<RespuestaDeConsola<{ numero: number }>> {
  const forma = entradaDePublicar(entrada);
  if (!forma.ok) return datosNoValidos();
  return protegida(async (acceso) => {
    const r = await acceso.casos.publicarVersionDePlan(forma.valor);
    return r.ok ? { ok: true, dato: { numero: r.valor.numero } } : falla(r.error);
  });
}
