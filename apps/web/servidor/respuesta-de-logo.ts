import "server-only";

import { respuestaDelLogo } from "../../../src/composicion/respuesta-de-logo";
import { puertaOpcional } from "./pedido";
import { logoDeLaVidriera } from "./vidriera";

/**
 * La ruta del logo de la carta vista desde la aplicación (`app/s/carta/[codigo]/logo/[version]/route.ts`): resuelve la puerta del host (otra vez: lo que dejó el proxy no se da por
 * bueno), pide el logo y deja la respuesta a `respuestaDelLogo`. Un host que no es de carta responde lo mismo que una carta sin logo.
 */
export async function atenderElLogo(codigo: string, tramoDeVersion: string): Promise<Response> {
  const puerta = await puertaOpcional("CARTA");
  return respuestaDelLogo(
    puerta === null ? null : await logoDeLaVidriera(puerta, codigo, tramoDeVersion),
  );
}
