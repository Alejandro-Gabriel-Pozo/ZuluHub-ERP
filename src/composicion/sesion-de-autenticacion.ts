import { ENCABEZADO_DE_IP } from "../capacidades/autenticacion/host-de-autenticacion";
import { origenEsPropio } from "../capacidades/experiencia/origen";
import { hostDelPedido } from "../capacidades/experiencia/puerta";
import { estadoHttpDe, type Respuesta } from "../capacidades/experiencia/respuesta";
import { aRespuestaDeExcepcion, respuestaDeFalla } from "./a-respuesta";
import type { DependenciasDeSesion } from "./dependencias-de-sesion";

export type PedidoDeAutenticacion = Readonly<{
  /** El host que resolvió la puerta (normalizado): el origen de lo que se le pide a la librería. */
  host: string;
  /** Los encabezados del pedido de la persona: de ahí salen la cookie y los datos para el límite de pedidos. */
  encabezados: Headers;
}>;

/**
 * Los encabezados que la librería necesita de verdad: la cookie y, para su límite de pedidos, la IP y el agente.
 * La IP es SOLO la del encabezado de confianza (`ENCABEZADO_DE_IP`, S3): `x-forwarded-for` ya no se copia. La
 * librería no lo lee (su configuración lista un único encabezado), y copiarlo dejaría a un cambio futuro de
 * configuración confiar sin querer en un valor que el cliente puede mandar.
 */
function encabezadosParaLaLibreria(p: PedidoDeAutenticacion): Headers {
  const salida = new Headers({
    origin: `https://${p.host}`,
    "content-type": "application/json",
  });
  for (const nombre of ["cookie", ENCABEZADO_DE_IP, "user-agent"]) {
    const valor = p.encabezados.get(nombre);
    if (valor !== null) salida.set(nombre, valor);
  }
  return salida;
}

export type CookiesParaAplicar = Readonly<{ cookies: readonly string[] }>;

/**
 * Cierra la sesión: la librería borra la fila (revocación inmediata) y devuelve los `Set-Cookie` que borran
 * la cookie en el navegador. Quien llama (la acción del servidor) los APLICA y vuelve al ingreso.
 */
export async function cerrarSesion(
  d: DependenciasDeSesion,
  pedido: PedidoDeAutenticacion,
): Promise<Respuesta<CookiesParaAplicar>> {
  try {
    const respuesta = await d.autenticacion().manejar(
      new Request(`https://${pedido.host}/api/auth/sign-out`, {
        method: "POST",
        headers: encabezadosParaLaLibreria(pedido),
        body: "{}",
      }),
      pedido.host,
    );
    return { ok: true, dato: { cookies: respuesta.headers.getSetCookie() } };
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

export type InicioDeIngreso = Readonly<{
  /** A dónde ir (la pantalla de Google), siempre `https:`. */
  url: string;
  /** Las cookies de estado del ingreso (hay que volver con ellas): se aplican antes de redirigir. */
  cookies: readonly string[];
}>;

/**
 * Empieza el ingreso con Google: le pide a la librería la dirección de Google y las cookies del estado del
 * ingreso. `volver` es una ruta propia ya validada (`rutaDeRetorno`).
 */
export async function iniciarIngresoConGoogle(
  d: DependenciasDeSesion,
  pedido: PedidoDeAutenticacion & Readonly<{ volver: string }>,
): Promise<Respuesta<InicioDeIngreso>> {
  try {
    const respuesta = await d.autenticacion().manejar(
      new Request(`https://${pedido.host}/api/auth/sign-in/social`, {
        method: "POST",
        headers: encabezadosParaLaLibreria(pedido),
        body: JSON.stringify({
          provider: "google",
          callbackURL: pedido.volver,
          errorCallbackURL: "/ingreso",
        }),
      }),
      pedido.host,
    );
    if (respuesta.status !== 200) {
      return {
        ok: false,
        error: respuestaDeFalla(`el inicio del ingreso respondió ${respuesta.status}`, d.respuesta),
      };
    }
    const cuerpo = (await respuesta.json()) as { url?: unknown };
    const url = typeof cuerpo.url === "string" ? cuerpo.url : "";
    if (!url.startsWith("https://")) {
      return {
        ok: false,
        error: respuestaDeFalla(
          "el inicio del ingreso no devolvió una dirección https",
          d.respuesta,
        ),
      };
    }
    return { ok: true, dato: { url, cookies: respuesta.headers.getSetCookie() } };
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/**
 * Atiende el «Seguir» del aviso de sesión (y la renovación silenciosa mientras se usa la pantalla): lee la
 * sesión del pedido, que con el uso se renueva en la base, y devuelve en la RESPUESTA los `Set-Cookie` que
 * la renuevan en el navegador. Un componente de servidor no puede fijar cookies, así que sin esto la cookie
 * moriría a los 15 minutos del ingreso aunque la persona use la aplicación (requisito de W3b). Solo desde el
 * propio origen (el `POST` lo garantiza la ruta). Sin sesión: 401 con el código `SESION_VENCIDA` y nada más.
 */
export async function renovarSesion(
  d: DependenciasDeSesion,
  pedido: PedidoDeAutenticacion,
): Promise<Response> {
  const cabeceras = new Headers({
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex",
    "Content-Type": "application/json",
  });
  const sinPermiso = (codigo: "SIN_PERMISO" | "SESION_VENCIDA") =>
    new Response(JSON.stringify({ codigo }), { status: estadoHttpDe(codigo), headers: cabeceras });
  // Una página de otro sitio no puede mantener viva una sesión que no es suya (P-7).
  if (!origenEsPropio(pedido.encabezados.get("origin"), hostDelPedido(pedido.encabezados))) {
    return sinPermiso("SIN_PERMISO");
  }
  try {
    const sesion = await d.autenticacion().sesionDe({ headers: pedido.encabezados }, pedido.host);
    if (sesion === null) return sinPermiso("SESION_VENCIDA");
    for (const cookie of sesion.cookiesDeRespuesta) cabeceras.append("Set-Cookie", cookie);
    return new Response(JSON.stringify({ venceEn: sesion.venceEn.toISOString() }), {
      status: 200,
      headers: cabeceras,
    });
  } catch (excepcion) {
    const error = aRespuestaDeExcepcion(excepcion, d.respuesta);
    return new Response(
      JSON.stringify(
        error.ok ? {} : { codigo: error.error.codigo, referencia: error.error.referencia },
      ),
      { status: 500, headers: cabeceras },
    );
  }
}
