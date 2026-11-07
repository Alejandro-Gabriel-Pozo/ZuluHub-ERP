import "server-only";
import { hostDelPedido } from "../../../src/capacidades/experiencia/puerta";
import { respuestaNeutra } from "../../../src/composicion/ruta-de-ingreso";
import { renovarSesion } from "../../../src/composicion/sesion-y-empresa";
import { resolverPuerta } from "./puerta";
import { dependenciasDeSesion } from "./sesion";

/**
 * Atiende `POST /api/sesion/renovar`: el «Seguir» del aviso de sesión y la renovación silenciosa mientras se
 * usa la pantalla. Es una RUTA y no un componente porque solo una ruta (o una acción) puede fijar cookies, y
 * la renovación de la sesión se entera al navegador por el `Set-Cookie` de la respuesta (W3b). Resuelve el
 * host otra vez: solo un host de aplicación la sirve; en cualquier otro, el 404 neutro.
 */
export async function atenderRenovacion(pedido: Request): Promise<Response> {
  const estado = await resolverPuerta(hostDelPedido(pedido.headers));
  if (estado.tipo === "NO_DISPONIBLE") return new Response(null, { status: 503 });
  if (estado.tipo !== "RESUELTA" || estado.puerta.superficie !== "APP") return respuestaNeutra();
  return renovarSesion(dependenciasDeSesion, {
    host: estado.puerta.host,
    encabezados: pedido.headers,
  });
}
