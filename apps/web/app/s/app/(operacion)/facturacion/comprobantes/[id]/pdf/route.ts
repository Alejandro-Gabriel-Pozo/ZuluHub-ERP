import { descargarElPdf } from "../../../../../../../../pantallas/descarga-del-pdf";

// `/facturacion/comprobantes/[id]/pdf`: el PDF A4 de un comprobante Autorizado, como descarga. Solo GET (y HEAD, que Next deriva de él: pasa
// por la misma autorización y no manda cuerpo); cualquier otro método responde 405. El servidor decide sesión, empresa, permiso y sucursal;
// el id es lo único que viene de la URL. Nunca se cachea ni se genera al compilar.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Tope de la función: 10 s. No llama a ARCA; el PDF tardó p99 106 ms (el primero de una instancia fría ~270 ms) en la medición con 1.000.000 de
// comprobantes (`rendimiento-medicion-2026-11.md` §10). Next: `maxDuration` en un route.ts (node_modules/next/dist/docs, maxDuration.md).
// Chequeo: `test/web/max-duration.test.ts`.
export const maxDuration = 10;

export async function GET(
  _pedido: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return descargarElPdf(id);
}
