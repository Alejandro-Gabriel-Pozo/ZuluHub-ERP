import "server-only";

import { detalleDeFalla } from "../../../src/capacidades/experiencia/respuesta";
import { respuestaDeFalla } from "../../../src/composicion/a-respuesta";
import { entradaDelAlta } from "../logica/entrada-del-alta";
import { errorParaLaPantalla } from "../logica/errores-de-plataforma";
import type { RespuestaDeConsola } from "../logica/respuesta-de-consola";
import { exigirAcceso } from "./acceso";

const DATOS_NO_VALIDOS = "Los datos no son válidos. Revisalos.";

type Falla = Extract<RespuestaDeConsola<never>, { ok: false }>;

/** Un fallo inesperado: el detalle va al registro del servidor con su referencia `PD-…`; el navegador solo recibe la referencia. */
function fallaInesperada(detalle: string): Falla {
  const publico = respuestaDeFalla(detalle, {
    registrar: (texto) => {
      console.error(`[alta] ${texto}`);
    },
  });
  return {
    ok: false,
    error: { tipo: "INESPERADO" },
    ...(publico.referencia === undefined ? {} : { referencia: publico.referencia }),
  };
}

/**
 * El alta de una empresa con tenant NUEVO desde la consola. La entrada viene del navegador: se valida la forma
 * (`entradaDelAlta`) y el resto lo decide el caso de uso. La clave de idempotencia es del intento y la trae el
 * navegador: esta acción no genera claves, y repetirla con la misma devuelve lo mismo sin crear otra empresa.
 * Nada del pedido (CUIT, email) va al registro.
 */
export async function altaDeEmpresaDeConsola(
  entrada: unknown,
): Promise<RespuestaDeConsola<{ empresaId: string; yaExistia: boolean }>> {
  const forma = entradaDelAlta(entrada);
  if (!forma.ok) return { ok: false, error: { tipo: "GENERAL", texto: DATOS_NO_VALIDOS } };
  const datos = forma.valor;
  try {
    const acceso = await exigirAcceso();
    const resultado = await acceso.casos.altaDeEmpresa({
      nombreDeTenant: datos.razonSocial.trim(),
      razonSocial: datos.razonSocial,
      cuit: datos.cuit,
      marcaId: datos.marcaId,
      ...(datos.versionDePlanId === null ? {} : { versionDePlanId: datos.versionDePlanId }),
      emailGerente: datos.emailGerente,
      zonaHoraria: datos.zonaHoraria,
      moneda: "ARS",
      claveDeIdempotencia: datos.claveDeIdempotencia,
    });
    if (resultado.ok) {
      return {
        ok: true,
        dato: { empresaId: resultado.valor.empresaId, yaExistia: resultado.valor.yaExistia },
      };
    }
    const error = errorParaLaPantalla(resultado.error);
    if (error.tipo === "INESPERADO") return fallaInesperada(detalleDeFalla(resultado.error));
    return { ok: false, error };
  } catch (excepcion) {
    // `redirect()` de `exigirAcceso` lanza a propósito: Next lo necesita para redirigir.
    if (esRedireccion(excepcion)) throw excepcion;
    return fallaInesperada(detalleDeFalla(excepcion));
  }
}

function esRedireccion(excepcion: unknown): boolean {
  if (typeof excepcion !== "object" || excepcion === null) return false;
  const digest = (excepcion as { digest?: unknown }).digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}
