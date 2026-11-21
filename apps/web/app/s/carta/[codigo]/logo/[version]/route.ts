import { atenderElLogo } from "../../../../../../servidor/respuesta-de-logo";

// `/<código>/logo/<versión>.webp`: el logo de la carta, traído del proveedor por el servidor y entregado desde la dirección de la propia carta (la CSP solo deja
// imágenes propias). Solo GET (y HEAD, que Next deriva de él); cualquier otro método responde 405. Todo lo que no se sirve es un 404 neutro.
// `node:https` y `node:dns` necesitan Node: nunca en el borde. Y no se genera al compilar: depende de la base y del host.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// El traedor corta a los 4 s y la lectura de la carta es la de la página: 10 s alcanzan con margen, y una función colgada no queda abierta de más.
export const maxDuration = 10;

export async function GET(
  _pedido: Request,
  { params }: { params: Promise<{ codigo: string; version: string }> },
): Promise<Response> {
  const { codigo, version } = await params;
  return atenderElLogo(codigo, version);
}
