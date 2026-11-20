import "server-only";

import { detalleDeFalla } from "../../../src/capacidades/experiencia/respuesta";
import { errorDelCambioDePlan } from "../logica/errores-de-cambio-de-plan";
import { entradaDeArrepentir } from "../logica/arrepentimiento";
import { entradaDelCambioDePlan } from "../logica/entrada-del-plan";
import type { RespuestaDeConsola } from "../logica/respuesta-de-consola";
import { instanteDeVigencia } from "../logica/vigencia";
import { exigirAcceso } from "./acceso";
import { esRedireccion, fallaInesperada, type Falla } from "./proteccion";

const DATOS_NO_VALIDOS = "Los datos no son válidos. Revisalos.";
const ETIQUETA = "plan";

const datosNoValidos = (): RespuestaDeConsola<never> => ({
  ok: false,
  error: { tipo: "GENERAL", texto: DATOS_NO_VALIDOS },
});

/** El error de un caso de uso para el navegador; lo inesperado va al registro con su referencia y sin datos del pedido. */
function falla(error: unknown): Falla {
  const paraLaPantalla = errorDelCambioDePlan(error);
  if (paraLaPantalla.tipo === "INESPERADO") {
    return fallaInesperada(ETIQUETA, detalleDeFalla(error));
  }
  return { ok: false, error: paraLaPantalla };
}

/**
 * Cambia el plan de una empresa (en realidad, de su cliente). La entrada viene del navegador: se valida la forma
 * y el resto lo decide el caso de uso. La clave de idempotencia y la fecha (AAAA-MM-DD) las fija el navegador:
 * esta acción no genera claves ni fechas.
 */
export async function cambiarPlanDeConsola(
  entrada: unknown,
): Promise<RespuestaDeConsola<{ numero: number; yaExistia: boolean }>> {
  const forma = entradaDelCambioDePlan(entrada);
  if (!forma.ok) return datosNoValidos();
  const datos = forma.valor;
  const vigenteDesde = instanteDeVigencia(datos.vigenteDesde);
  if (vigenteDesde === null) return datosNoValidos();
  try {
    const acceso = await exigirAcceso();
    const resultado = await acceso.casos.asignarPlan({
      claveDeIdempotencia: datos.claveDeIdempotencia,
      tenantId: datos.tenantId,
      versionDePlanId: datos.versionDePlanId,
      vigenteDesde,
      motivo: datos.motivo,
      numeroEsperado: datos.numeroEsperado,
      reemplazaProgramada: datos.reemplazaProgramada,
    });
    if (resultado.ok) {
      return {
        ok: true,
        dato: { numero: resultado.valor.numero, yaExistia: resultado.valor.yaExistia },
      };
    }
    return falla(resultado.error);
  } catch (excepcion) {
    if (esRedireccion(excepcion)) throw excepcion;
    return fallaInesperada(ETIQUETA, detalleDeFalla(excepcion));
  }
}

/**
 * Deshace por arrepentimiento el último cambio de plan de un cliente (solo ADMIN con segundo factor reciente: lo exige el caso de uso, no esta acción). La entrada viene del navegador: se valida la forma
 * y el resto lo decide el caso de uso (que el cambio sea de ESE cliente, que sea el último, el plazo y que no se haya deshecho). La clave de idempotencia la fija el navegador (una por intento).
 */
export async function arrepentirCambioDeConsola(
  entrada: unknown,
): Promise<RespuestaDeConsola<{ numero: number }>> {
  const forma = entradaDeArrepentir(entrada);
  if (!forma.ok) return datosNoValidos();
  try {
    const acceso = await exigirAcceso();
    const resultado = await acceso.casos.arrepentirCambioDePlan(forma.valor);
    return resultado.ok
      ? { ok: true, dato: { numero: resultado.valor.numero } }
      : falla(resultado.error);
  } catch (excepcion) {
    if (esRedireccion(excepcion)) throw excepcion;
    return fallaInesperada(ETIQUETA, detalleDeFalla(excepcion));
  }
}
