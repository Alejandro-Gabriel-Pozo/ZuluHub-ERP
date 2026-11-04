import "server-only";

import { detalleDeFalla } from "../../../src/capacidades/experiencia/respuesta";
import { respuestaDeFalla } from "../../../src/composicion/a-respuesta";
import { errorParaLaPantalla, type ErrorParaLaPantalla } from "../logica/errores-de-plataforma";

/** El fallo de una lectura: el error para la pantalla y, si fue inesperado, su referencia `PD-…`. */
export type Falla = Readonly<{
  ok: false;
  error: ErrorParaLaPantalla;
  referencia?: string;
}>;

/** Un fallo inesperado: detalle y referencia al registro del servidor; hacia afuera, solo la referencia. */
export function fallaInesperada(etiqueta: string, detalle: string): Falla {
  const publico = respuestaDeFalla(detalle, {
    registrar: (texto) => {
      console.error(`[${etiqueta}] ${texto}`);
    },
  });
  return {
    ok: false,
    error: { tipo: "INESPERADO" },
    ...(publico.referencia === undefined ? {} : { referencia: publico.referencia }),
  };
}

/** El error de un resultado, listo para la pantalla; si es inesperado, con su referencia. */
export function fallaDe(etiqueta: string, error: unknown): Falla {
  const paraLaPantalla = errorParaLaPantalla(error, "SUBMARCA");
  if (paraLaPantalla.tipo === "INESPERADO") return fallaInesperada(etiqueta, detalleDeFalla(error));
  return { ok: false, error: paraLaPantalla };
}

/** `redirect()` de `exigirAcceso` lanza a propósito: Next lo necesita para redirigir. */
export function esRedireccion(excepcion: unknown): boolean {
  if (typeof excepcion !== "object" || excepcion === null) return false;
  const digest = (excepcion as { digest?: unknown }).digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

/** Corre una lectura capturando toda excepción: la pantalla nunca recibe el detalle. */
export async function protegida<T>(
  etiqueta: string,
  lectura: () => Promise<T | Falla>,
): Promise<T | Falla> {
  try {
    return await lectura();
  } catch (excepcion) {
    if (esRedireccion(excepcion)) throw excepcion;
    return fallaInesperada(etiqueta, detalleDeFalla(excepcion));
  }
}
