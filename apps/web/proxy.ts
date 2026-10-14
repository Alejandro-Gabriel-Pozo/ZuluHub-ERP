import { NextResponse, type NextRequest } from "next/server";
import { cabecerasDe, nonceDe } from "../../src/capacidades/experiencia/cabeceras";
import { respuestaDeMantenimiento } from "../../src/capacidades/experiencia/mantenimiento";
import {
  HOST_DESCONOCIDO,
  decidirPuerta,
  esRutaDeSistema,
  hostDelPedido,
} from "../../src/capacidades/experiencia/puerta";
import { referenciaDeError } from "../../src/plataforma/dominio/referencia";
import { baseAlDia } from "./servidor/guarda";
import { despliegueEsProduccion, resolverPuerta } from "./servidor/puerta";

/**
 * La puerta por host (armazón web §3.2). Delgada a propósito: traduce a la API de Next lo que decide la
 * función pura `decidirPuerta` (`src/capacidades/experiencia/puerta.ts`), que se prueba y se muta sin
 * levantar Next. Acá solo se juntan los datos: el host (SOLO la cabecera `host`), su resolución, un nonce
 * nuevo por pedido y si el despliegue es el de producción.
 *
 * Esta es una barrera, no la única: cada página, acción y ruta vuelve a resolver el host por su cuenta.
 *
 * Dos cosas más, ambas de la puesta en marcha (W6):
 *  - Las rutas de sistema (`/api/trabajos/cron` y `/api/salud`, lista cerrada) siguen su camino en cualquier
 *    host SIN resolver la marca: no consultan la base de marcas ni dependen de ella, y cada una se autoriza o
 *    se limita por su cuenta.
 *  - La guarda de migración: con cualquier otra ruta, si la base no tiene la migración que el código necesita,
 *    la respuesta es «En mantenimiento» (503 con referencia) antes de tocar nada más. Las de sistema quedan
 *    afuera a propósito: la salud tiene que poder decir «no ok» y el cron no depende de las páginas.
 */
export async function proxy(pedido: NextRequest): Promise<NextResponse> {
  const ruta = pedido.nextUrl.pathname;
  const nonce = nonceDe(crypto.getRandomValues(new Uint8Array(16)));
  const produccion = despliegueEsProduccion();
  const deSistema = esRutaDeSistema(ruta);
  if (!deSistema && !(await baseAlDia())) {
    // La referencia de la pantalla queda en el registro, junto al motivo que dejó la guarda: así soporte la busca.
    const referencia = referenciaDeError(crypto.getRandomValues(new Uint8Array(4)));
    console.error(`${referencia} [mantenimiento] pedido atendido sin la migración requerida`);
    const mantenimiento = respuestaDeMantenimiento({
      referencia,
      cabeceras: cabecerasDe("NEUTRA", nonce, { produccion }),
    });
    return new NextResponse(mantenimiento.cuerpo, {
      status: mantenimiento.estado,
      headers: mantenimiento.encabezados,
    });
  }
  const decision = decidirPuerta({
    encabezados: pedido.headers,
    ruta,
    resolucion: deSistema ? HOST_DESCONOCIDO : await resolverPuerta(hostDelPedido(pedido.headers)),
    produccion,
    nonce,
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
