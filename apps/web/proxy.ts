import { NextResponse, type NextRequest } from "next/server";
import { decidirPuerta } from "../../src/capacidades/experiencia/puerta";

/**
 * Puerta mínima de W0: todo pedido, de cualquier host, se reescribe a la página neutra. No resuelve
 * marca (eso llega en W4). La lógica está en `src/capacidades/experiencia/puerta.ts`, que se prueba
 * sin levantar Next; acá solo se traduce la decisión a la API de Next.
 */
export function proxy(pedido: NextRequest): NextResponse {
  const decision = decidirPuerta(pedido.headers);
  const destino = pedido.nextUrl.clone();
  destino.pathname = decision.rutaInterna;
  destino.search = "";
  const respuesta = NextResponse.rewrite(destino, {
    request: { headers: decision.encabezadosDePedido },
    status: 404,
  });
  for (const [nombre, valor] of Object.entries(decision.encabezadosDeRespuesta)) {
    respuesta.headers.set(nombre, valor);
  }
  return respuesta;
}

export const config = {
  // Todo menos los archivos estáticos que sirve Next para la compilación.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
