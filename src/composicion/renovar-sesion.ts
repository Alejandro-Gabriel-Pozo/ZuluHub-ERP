import { origenEsPropio } from "../capacidades/experiencia/origen";
import { hostDelPedido } from "../capacidades/experiencia/puerta";
import { estadoHttpDe } from "../capacidades/experiencia/respuesta";
import { aRespuestaDeExcepcion } from "./a-respuesta";
import type { DependenciasDeSesion, PedidoDeAutenticacion } from "./sesion-y-empresa";

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
    // `renovarYa`: el «Seguir» y la renovación silenciosa escriben el uso aunque se haya anotado hace menos de un minuto; sin eso no
    // habría cookie nueva que devolver (una vista de pantalla anota el uso a lo sumo una vez por minuto y no puede fijar cookies).
    const sesion = await d
      .autenticacion()
      .sesionDe({ headers: pedido.encabezados }, pedido.host, { renovarYa: true });
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
