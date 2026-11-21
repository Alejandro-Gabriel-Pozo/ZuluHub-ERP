import "server-only";

import type { AlcanceDelHost } from "../../../src/capacidades/experiencia/puerta";
import { respuestaDelLogo } from "../../../src/composicion/respuesta-de-logo";
import { logoDeLaVidriera } from "./vidriera";

/**
 * La ruta del logo de la carta vista desde la aplicación (`app/s/carta/[codigo]/logo/[version]/route.ts`): con la PUERTA ENTERA que resolvió la ruta para el host del pedido (marca y dueño, como
 * las páginas de la carta: H-DOM-1), pide el logo y deja la respuesta a `respuestaDelLogo`. Sin puerta de carta (un host que no es de carta) responde lo mismo que una carta sin logo.
 */
export async function atenderElLogo(
  puerta: AlcanceDelHost | null,
  codigo: string,
  tramoDeVersion: string,
): Promise<Response> {
  return respuestaDelLogo(
    puerta === null ? null : await logoDeLaVidriera(puerta, codigo, tramoDeVersion),
  );
}
