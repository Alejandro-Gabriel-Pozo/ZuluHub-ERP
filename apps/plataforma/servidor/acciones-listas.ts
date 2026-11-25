import "server-only";

import { detalleDeFalla } from "../../../src/capacidades/experiencia/respuesta";
import {
  entradaDeAgregarValor,
  entradaDeCambiarEstado,
  entradaDeCorregirNombre,
} from "../logica/entrada-de-lista";
import { errorParaLaPantalla } from "../logica/errores-de-plataforma";
import type { RespuestaDeConsola } from "../logica/respuesta-de-consola";
import { exigirAcceso } from "./acceso";
import { esRedireccion, fallaInesperada, type Falla } from "./proteccion";

const DATOS_NO_VALIDOS = "Los datos no son válidos. Revisalos.";
const ETIQUETA = "listas";

const datosNoValidos = (): RespuestaDeConsola<never> => ({
  ok: false,
  error: { tipo: "GENERAL", texto: DATOS_NO_VALIDOS },
});

/** El error de un caso de uso para el navegador; lo inesperado va al registro con su referencia y sin datos del pedido. */
function falla(error: unknown): Falla {
  const paraLaPantalla = errorParaLaPantalla(error, "LISTA");
  if (paraLaPantalla.tipo === "INESPERADO") {
    return fallaInesperada(ETIQUETA, detalleDeFalla(error));
  }
  return { ok: false, error: paraLaPantalla };
}

type Salida = RespuestaDeConsola<{ version: number }>;

/**
 * Corre un caso de uso de listas con el acceso de este pedido. Todo caso pide `listas.editar` y el segundo factor reciente a la puerta de la consola; un
 * `redirect` de Next se relanza; lo que lance cualquier otra cosa sale como inesperado, con referencia y sin el pedido.
 */
async function ejecutar(
  correr: (
    acceso: Awaited<ReturnType<typeof exigirAcceso>>,
  ) => Promise<{ ok: true; valor: { version: number } } | { ok: false; error: unknown }>,
): Promise<Salida> {
  try {
    const acceso = await exigirAcceso();
    const resultado = await correr(acceso);
    if (resultado.ok) return { ok: true, dato: { version: resultado.valor.version } };
    return falla(resultado.error);
  } catch (excepcion) {
    if (esRedireccion(excepcion)) throw excepcion;
    return fallaInesperada(ETIQUETA, detalleDeFalla(excepcion));
  }
}

/** Agrega un valor a la lista. Repetir el pedido (misma clave) no agrega otro; el mismo nombre con otra clave es `VALOR_DUPLICADO`. */
export async function agregarValorDeConsola(entrada: unknown): Promise<Salida> {
  const forma = entradaDeAgregarValor(entrada);
  if (!forma.ok) return datosNoValidos();
  const { claveDeIdempotencia, lista, nombre } = forma.valor;
  return ejecutar(async (acceso) => {
    const r = await acceso.casos.agregarValorDeLista({
      claveDeIdempotencia,
      lista: lista.lista,
      nombre,
    });
    return r.ok ? { ok: true, valor: { version: r.valor.version } } : r;
  });
}

/** Corrige el nombre de un valor (con la versión que la pantalla vio). */
export async function corregirNombreDeConsola(entrada: unknown): Promise<Salida> {
  const forma = entradaDeCorregirNombre(entrada);
  if (!forma.ok) return datosNoValidos();
  return ejecutar(async (acceso) => {
    const r = await acceso.casos.corregirNombreDeValor(forma.valor);
    return r.ok ? { ok: true, valor: { version: r.valor.version } } : r;
  });
}

/** Desactiva un valor: deja de ofrecerse en lo nuevo y lo ya hecho lo conserva. Nada se borra. */
export async function desactivarValorDeConsola(entrada: unknown): Promise<Salida> {
  const forma = entradaDeCambiarEstado(entrada);
  if (!forma.ok) return datosNoValidos();
  return ejecutar(async (acceso) => {
    const r = await acceso.casos.desactivarValorDeLista(forma.valor);
    return r.ok ? { ok: true, valor: { version: r.valor.version } } : r;
  });
}

/** Reactiva un valor desactivado. */
export async function reactivarValorDeConsola(entrada: unknown): Promise<Salida> {
  const forma = entradaDeCambiarEstado(entrada);
  if (!forma.ok) return datosNoValidos();
  return ejecutar(async (acceso) => {
    const r = await acceso.casos.reactivarValorDeLista(forma.valor);
    return r.ok ? { ok: true, valor: { version: r.valor.version } } : r;
  });
}
