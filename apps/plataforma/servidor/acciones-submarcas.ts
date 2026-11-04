import "server-only";

import { detalleDeFalla } from "../../../src/capacidades/experiencia/respuesta";
import { entradaDeLaConfirmacion, entradaDelBorrador } from "../logica/entrada-de-submarca";
import { errorParaLaPantalla } from "../logica/errores-de-plataforma";
import type { RespuestaDeConsola } from "../logica/respuesta-de-consola";
import { instanteDeVigencia } from "../logica/vigencia";
import { exigirAcceso } from "./acceso";
import { esRedireccion, fallaInesperada, type Falla } from "./proteccion";

const DATOS_NO_VALIDOS = "Los datos no son válidos. Revisalos.";
const ETIQUETA = "submarca";

const datosNoValidos = (): RespuestaDeConsola<never> => ({
  ok: false,
  error: { tipo: "GENERAL", texto: DATOS_NO_VALIDOS },
});

/** El error de un caso de uso para el navegador; lo inesperado va al registro con su referencia y sin datos del pedido. */
function falla(error: unknown): Falla {
  const paraLaPantalla = errorParaLaPantalla(error, "SUBMARCA");
  if (paraLaPantalla.tipo === "INESPERADO") {
    return fallaInesperada(ETIQUETA, detalleDeFalla(error));
  }
  return { ok: false, error: paraLaPantalla };
}

/**
 * Guarda el borrador de una submarca. La entrada viene del navegador: se valida la forma (`entradaDelBorrador`) y el
 * resto lo decide el caso de uso. La clave de idempotencia la trae el navegador: esta acción no genera claves.
 */
export async function guardarBorradorDeSubmarcaDeConsola(
  entrada: unknown,
): Promise<RespuestaDeConsola<{ version: number }>> {
  const forma = entradaDelBorrador(entrada);
  if (!forma.ok) return datosNoValidos();
  const { claveDeIdempotencia, marcaId, versionEsperada, cambios } = forma.valor;
  try {
    const acceso = await exigirAcceso();
    const resultado = await acceso.casos.guardarBorradorDeMarca({
      claveDeIdempotencia,
      marcaId,
      versionEsperada,
      ...(cambios.nombreVisible === undefined ? {} : { nombreVisible: cambios.nombreVisible }),
      ...(cambios.tema === undefined ? {} : { tema: { ...cambios.tema } }),
      ...(cambios.aspecto === undefined ? {} : { aspecto: { ...cambios.aspecto } }),
    });
    if (resultado.ok) return { ok: true, dato: { version: resultado.valor.version } };
    return falla(resultado.error);
  } catch (excepcion) {
    if (esRedireccion(excepcion)) throw excepcion;
    return fallaInesperada(ETIQUETA, detalleDeFalla(excepcion));
  }
}

/**
 * Confirma una versión de la submarca desde el borrador. La fecha viaja como AAAA-MM-DD fijada por el navegador
 * junto con la clave de idempotencia: la acción no usa reloj propio para fijarla.
 */
export async function confirmarVersionDeSubmarcaDeConsola(
  entrada: unknown,
): Promise<RespuestaDeConsola<{ numero: number }>> {
  const forma = entradaDeLaConfirmacion(entrada);
  if (!forma.ok) return datosNoValidos();
  const datos = forma.valor;
  const vigenteDesde = instanteDeVigencia(datos.vigenteDesde);
  if (vigenteDesde === null) return datosNoValidos();
  try {
    const acceso = await exigirAcceso();
    const resultado = await acceso.casos.confirmarVersionDeMarca({
      claveDeIdempotencia: datos.claveDeIdempotencia,
      marcaId: datos.marcaId,
      versionEsperada: datos.versionEsperada,
      vigenteDesde,
      motivo: datos.motivo,
      reemplazaProgramada: datos.reemplazaProgramada,
    });
    if (resultado.ok) return { ok: true, dato: { numero: resultado.valor.numero } };
    return falla(resultado.error);
  } catch (excepcion) {
    if (esRedireccion(excepcion)) throw excepcion;
    return fallaInesperada(ETIQUETA, detalleDeFalla(excepcion));
  }
}
