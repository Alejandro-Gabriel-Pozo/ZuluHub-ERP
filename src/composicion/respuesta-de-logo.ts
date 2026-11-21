/**
 * La respuesta HTTP de `/<código>/logo/<versión>.webp` (carta, §5.7.5), sin Next: la ruta de la web solo junta sus dependencias y llama a esto, y acá se prueba y se
 * muta (como las rutas de sistema). Una sola respuesta para todo lo que no se sirve: 404 plano, sin cuerpo y sin guardarse (nada de «la carta no existe» frente a «no
 * tiene logo» frente a «el proveedor falló»: no hay oráculo). Lo que se sirve es la imagen ya validada por el traedor: `image/webp`, sin que el navegador adivine otro
 * tipo, y guardable un día (el enlace lleva la versión, así que un logo nuevo es otra dirección).
 */
export const CABECERAS_DEL_LOGO_SERVIDO = {
  "Content-Type": "image/webp",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "public, max-age=86400",
} as const;

export function respuestaDelLogo(bytes: Uint8Array | null): Response {
  if (bytes === null)
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: { ...CABECERAS_DEL_LOGO_SERVIDO, "Content-Length": String(bytes.length) },
  });
}
