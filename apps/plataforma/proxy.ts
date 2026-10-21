import { NextResponse, type NextRequest } from "next/server";
import {
  cabecerasDe,
  nonceDe,
  politicaDeContenido,
} from "../../src/capacidades/experiencia/cabeceras";
import {
  ENCABEZADO_DE_NONCE,
  sinEncabezadosInternos,
} from "../../src/capacidades/experiencia/puerta";

/**
 * Las cabeceras de seguridad de la consola: la misma política de contenido de la web (scripts propios con nonce, sin
 * marcos, sin objetos) y nada que se indexe ni se guarde en caché. Un nonce nuevo por pedido, que Next toma de la
 * propia política para marcar sus scripts. No decide acceso: eso lo hace cada página y cada ruta con la sesión.
 */
export function proxy(pedido: NextRequest): NextResponse {
  const nonce = nonceDe(crypto.getRandomValues(new Uint8Array(16)));
  const encabezados = sinEncabezadosInternos(pedido.headers);
  encabezados.set("content-security-policy", politicaDeContenido(nonce));
  encabezados.set(ENCABEZADO_DE_NONCE, nonce);
  const respuesta = NextResponse.next({ request: { headers: encabezados } });
  for (const [nombre, valor] of Object.entries(cabecerasDe("APP", nonce, { produccion: true }))) {
    respuesta.headers.set(nombre, valor);
  }
  return respuesta;
}

export const config = {
  // Todo menos los archivos estáticos que sirve Next para la compilación.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
