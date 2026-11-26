import {
  CODIGOS_PUBLICOS,
  type ErrorPublico,
} from "../../../src/capacidades/experiencia/respuesta";
import { exportarElArchivoDeCuentaCorriente } from "../servidor/cuenta-corriente-exportacion";

/**
 * La descarga del archivo de la cuenta corriente (ruta `/caja/cuenta-corriente/exportar`). Mismo molde que la de compras: el pedido se pasa por `exportarElArchivoDeCuentaCorriente` (sesión,
 * empresa y permisos los decide el servidor; del pedido no se lee NADA: es una foto de todos los clientes con ficha al día de hoy) y recién con su resultado sale el archivo.
 *
 * - Nunca se cachea (`private, no-store`): lleva importes y datos de clientes de la empresa.
 * - El nombre del archivo sale del código y de la fecha que calculó el servidor; nada que escriba el cliente va en la cabecera.
 * - Un error sale SOLO como `{ codigo, referencia? }` con el estado HTTP de su código: sin texto, sin detalle y sin lo que el cliente escribió.
 * - Falla cerrado: ante cualquier fallo no sale un archivo a medias.
 * Chequeo: `test/web/cuenta-corriente-exportacion-descarga.test.ts`.
 */

const SIN_CACHE = "private, no-store";
const TIPO_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function respuestaDeError(error: ErrorPublico): Response {
  const cuerpo = JSON.stringify({
    codigo: error.codigo,
    ...(error.referencia === undefined ? {} : { referencia: error.referencia }),
  });
  return new Response(cuerpo, {
    status: CODIGOS_PUBLICOS[error.codigo].estadoHttp,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": SIN_CACHE,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function descargarElArchivoDeCuentaCorriente(): Promise<Response> {
  const lectura = await exportarElArchivoDeCuentaCorriente();
  if (!lectura.ok) return respuestaDeError(lectura.error);
  const { nombre, contenido } = lectura.dato;
  return new Response(contenido as Uint8Array<ArrayBuffer>, {
    status: 200,
    headers: {
      "Content-Type": TIPO_XLSX,
      "Content-Disposition": `attachment; filename="${nombre}"`,
      "Content-Length": String(contenido.byteLength),
      "Cache-Control": SIN_CACHE,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
