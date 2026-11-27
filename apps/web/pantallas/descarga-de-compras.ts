import {
  CODIGOS_PUBLICOS,
  type ErrorPublico,
} from "../../../src/capacidades/experiencia/respuesta";
import { exportarElArchivoDeCompras } from "../servidor/compras-exportacion";

/**
 * La descarga del archivo de compras (ruta `/compras/exportar`). Mismo molde que la del PDF: el pedido se pasa por `exportarElArchivoDeCompras` (sesión, empresa, permisos y alcance los
 * decide el servidor; del pedido solo se leen `desde` y `hasta`, ya validados como fechas civiles dentro de 12 meses) y recién con su resultado sale el archivo.
 *
 * - Nunca se cachea (`private, no-store`): lleva importes de la empresa.
 * - El nombre del archivo sale del catálogo y de las dos fechas validadas; nada que escriba el cliente va en la cabecera.
 * - Un error sale SOLO como `{ codigo, referencia? }` con el estado HTTP de su código: sin texto, sin detalle y sin lo que el cliente escribió.
 * - Falla cerrado: ante cualquier fallo no sale un archivo a medias.
 * Chequeo: `test/web/compras-exportacion-descarga.test.ts`.
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

export async function descargarElArchivoDeCompras(parametros: URLSearchParams): Promise<Response> {
  const lectura = await exportarElArchivoDeCompras({
    desde: parametros.get("desde") ?? undefined,
    hasta: parametros.get("hasta") ?? undefined,
  });
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
