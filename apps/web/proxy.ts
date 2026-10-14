import { NextResponse, type NextRequest } from "next/server";
import { nonceDe } from "../../src/capacidades/experiencia/cabeceras";
import { decidirPuerta, hostDelPedido } from "../../src/capacidades/experiencia/puerta";
import { despliegueEsProduccion, resolverPuerta } from "./servidor/puerta";

/**
 * La puerta por host (armazón web §3.2). Delgada a propósito: traduce a la API de Next lo que decide la
 * función pura `decidirPuerta` (`src/capacidades/experiencia/puerta.ts`), que se prueba y se muta sin
 * levantar Next. Acá solo se juntan los datos: el host (SOLO la cabecera `host`), su resolución, un nonce
 * nuevo por pedido y si el despliegue es el de producción.
 *
 * Esta es una barrera, no la única: cada página, acción y ruta vuelve a resolver el host por su cuenta.
 */
export async function proxy(pedido: NextRequest): Promise<NextResponse> {
  const decision = decidirPuerta({
    encabezados: pedido.headers,
    ruta: pedido.nextUrl.pathname,
    resolucion: await resolverPuerta(hostDelPedido(pedido.headers)),
    produccion: despliegueEsProduccion(),
    nonce: nonceDe(crypto.getRandomValues(new Uint8Array(16))),
  });
  const opciones = { request: { headers: decision.encabezadosDePedido } };
  let respuesta: NextResponse;
  if (decision.accion === "SEGUIR" || decision.rutaInterna === null) {
    respuesta = NextResponse.next(opciones);
  } else {
    const destino = pedido.nextUrl.clone();
    destino.pathname = decision.rutaInterna;
    // La neutra no guarda nada del pedido (ni la consulta: puede traer un token).
    destino.search = decision.superficie === "NEUTRA" ? "" : pedido.nextUrl.search;
    respuesta = NextResponse.rewrite(destino, {
      ...opciones,
      ...(decision.estado === null ? {} : { status: decision.estado }),
    });
  }
  for (const [nombre, valor] of Object.entries(decision.encabezadosDeRespuesta)) {
    respuesta.headers.set(nombre, valor);
  }
  return respuesta;
}

export const config = {
  // Todo menos los archivos estáticos que sirve Next para la compilación.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
