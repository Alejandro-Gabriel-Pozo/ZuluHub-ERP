import "server-only";

import { detalleDeFalla } from "../../../src/capacidades/experiencia/respuesta";
import { entradaDelCambioDeModulo } from "../logica/entrada-del-modulo";
import { errorParaLaPantalla } from "../logica/errores-de-plataforma";
import type { RespuestaDeConsola } from "../logica/respuesta-de-consola";
import { exigirAcceso } from "./acceso";
import { esRedireccion, fallaInesperada, type Falla } from "./proteccion";

const DATOS_NO_VALIDOS = "Los datos no son válidos. Revisalos.";
const ETIQUETA = "modulos";

const datosNoValidos = (): RespuestaDeConsola<never> => ({
  ok: false,
  error: { tipo: "GENERAL", texto: DATOS_NO_VALIDOS },
});

/** El error de un caso de uso para el navegador; lo inesperado va al registro con su referencia y sin datos del pedido. */
function falla(error: unknown): Falla {
  const paraLaPantalla = errorParaLaPantalla(error, "MODULOS");
  if (paraLaPantalla.tipo === "INESPERADO") {
    return fallaInesperada(ETIQUETA, detalleDeFalla(error));
  }
  return { ok: false, error: paraLaPantalla };
}

/**
 * Activa o desactiva un módulo de una empresa. La entrada viene del navegador: se valida la forma y el resto
 * (permiso de administrador con segundo factor reciente, plan, dependencias) lo decide el caso de uso. La clave
 * de idempotencia la fija el navegador por intento: esta acción no genera claves.
 */
export async function cambiarModuloDeConsola(
  entrada: unknown,
): Promise<RespuestaDeConsola<{ yaEstaba: boolean }>> {
  const forma = entradaDelCambioDeModulo(entrada);
  if (!forma.ok) return datosNoValidos();
  const { activar, ...pedido } = forma.valor;
  try {
    const acceso = await exigirAcceso();
    if (activar) {
      const resultado = await acceso.casos.activarModuloDeEmpresa(pedido);
      return resultado.ok
        ? { ok: true, dato: { yaEstaba: resultado.valor.yaEstabaActivo } }
        : falla(resultado.error);
    }
    const resultado = await acceso.casos.desactivarModuloDeEmpresa(pedido);
    return resultado.ok
      ? { ok: true, dato: { yaEstaba: resultado.valor.yaEstabaInactivo } }
      : falla(resultado.error);
  } catch (excepcion) {
    if (esRedireccion(excepcion)) throw excepcion;
    return fallaInesperada(ETIQUETA, detalleDeFalla(excepcion));
  }
}
