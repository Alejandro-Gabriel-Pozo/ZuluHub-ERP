import "server-only";

import { puertaOpcional } from "./pedido";
import { logoDeLaVidriera } from "./vidriera";

/**
 * La respuesta de `/<código>/logo/<versión>.webp` (§5.7.5). Una sola respuesta para todo lo que no se sirve: 404 plano, sin cuerpo y sin guardarse (nada de «la carta no
 * existe» frente a «no tiene logo» frente a «el proveedor falló»: no hay oráculo). Lo que se sirve es la imagen ya validada por el traedor: `image/webp`, sin que el
 * navegador adivine otro tipo, y guardable un día (el enlace lleva la versión, así que un logo nuevo es otra dirección).
 */
export const CABECERAS_DEL_LOGO_SERVIDO = {
  "Content-Type": "image/webp",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "public, max-age=86400",
} as const;

const NO_ESTA = (): Response =>
  new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });

export async function atenderElLogo(codigo: string, tramoDeVersion: string): Promise<Response> {
  const puerta = await puertaOpcional("CARTA");
  if (puerta === null) return NO_ESTA();
  const bytes = await logoDeLaVidriera(puerta, codigo, tramoDeVersion);
  if (bytes === null) return NO_ESTA();
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: { ...CABECERAS_DEL_LOGO_SERVIDO, "Content-Length": String(bytes.length) },
  });
}
