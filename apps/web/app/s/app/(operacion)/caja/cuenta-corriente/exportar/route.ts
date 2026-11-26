import { descargarElArchivoDeCuentaCorriente } from "../../../../../../../pantallas/descarga-de-cuenta-corriente";

// `/caja/cuenta-corriente/exportar`: el archivo de Excel de la cuenta corriente de todos los clientes con ficha, al día de hoy, como descarga. Sin parámetros: el servidor decide sesión, empresa y
// permisos (`cuenta_corriente.ver`). Solo GET; cualquier otro método responde 405 (HEAD incluido, ver abajo). Nunca se cachea ni se genera al compilar. Cada descarga deja su registro de auditoría
// (quién, cuándo, a qué día y cuántas filas, sin los datos). El botón «Exportar» de la pantalla lo pone CC-1; esta ruta es lo único que ese botón necesita.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Tope de la función: 30 s. Lee hasta 20.000 filas en una transacción y escribe el archivo en memoria; no llama a nadie de afuera. Supuesto con margen hasta medirlo en la base real de preview.
// Next: `maxDuration` en un route.ts. Chequeo: `test/web/max-duration.test.ts`.
export const maxDuration = 30;

export async function GET(): Promise<Response> {
  return descargarElArchivoDeCuentaCorriente();
}

// HEAD no exporta ni deja registro de auditoría: Next lo derivaría de GET y correría toda la exportación sin mandar el cuerpo. Se rechaza con 405.
export function HEAD(): Response {
  return new Response(null, { status: 405, headers: { Allow: "GET" } });
}
