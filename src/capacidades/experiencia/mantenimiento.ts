import { cabecerasDe } from "./cabeceras";

/**
 * La respuesta de «En mantenimiento» (armazón web §5.7, guarda `MIGRACION_REQUERIDA`): lo que ve quien pide
 * cualquier cosa mientras la base no tiene la migración que el código necesita. Función pura: la referencia
 * y el nonce entran como dato, así se prueba y se muta sin Next.
 *
 *  - 503 (no 404): es una falla del servicio, no una página que no existe; con `Retry-After`.
 *  - Las mismas cabeceras que la página neutra (nunca se indexa, sin caché, sin cookies): no muestra marca
 *    ni dice cuál es la causa. La causa va al registro del servidor; acá solo la referencia `ZH-…` (ADR-016).
 *  - Sin estilos en línea ni scripts: se pinta aunque la política de contenido sea estricta y no depende de
 *    ninguna hoja de estilos que tampoco se pueda servir.
 */

/** Cuánto le pide al navegador que espere antes de volver a intentar. */
export const REINTENTO_DE_MANTENIMIENTO_EN_S = 60;

/** La forma de una referencia (`referenciaDeError`): lo único que se permite escribir dentro del HTML. */
const FORMA_DE_REFERENCIA = /^ZH-[0-9A-F]{4}-[0-9A-F]{4}$/;

export type RespuestaDeMantenimiento = Readonly<{
  estado: 503;
  cuerpo: string;
  encabezados: Readonly<Record<string, string>>;
}>;

export function respuestaDeMantenimiento(
  entrada: Readonly<{ referencia: string; nonce: string; produccion: boolean }>,
): RespuestaDeMantenimiento {
  const { referencia, nonce, produccion } = entrada;
  // Una referencia con otra forma podría traer marcas HTML: es un defecto de quien llama, no se escapa.
  if (!FORMA_DE_REFERENCIA.test(referencia)) {
    throw new RangeError("la referencia no tiene la forma ZH-XXXX-XXXX");
  }
  const cuerpo = [
    "<!doctype html>",
    '<html lang="es-AR">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex">',
    "<title>En mantenimiento</title>",
    "</head>",
    "<body>",
    "<main>",
    "<h1>En mantenimiento</h1>",
    "<p>Estamos actualizando el sistema. Volvé a intentar en unos minutos.</p>",
    `<p>Si sigue igual, avisale a soporte esta referencia: <strong>${referencia}</strong></p>`,
    "</main>",
    "</body>",
    "</html>",
  ].join("\n");
  return {
    estado: 503,
    cuerpo,
    encabezados: {
      ...cabecerasDe("NEUTRA", nonce, { produccion }),
      "Content-Type": "text/html; charset=utf-8",
      "Retry-After": String(REINTENTO_DE_MANTENIMIENTO_EN_S),
    },
  };
}
