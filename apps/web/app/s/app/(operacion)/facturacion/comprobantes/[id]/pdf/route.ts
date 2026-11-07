import { descargarElPdf } from "../../../../../../../../pantallas/descarga-del-pdf";

// `/facturacion/comprobantes/[id]/pdf`: el PDF A4 de un comprobante Autorizado, como descarga. Solo GET (y HEAD, que Next deriva de él: pasa
// por la misma autorización y no manda cuerpo); cualquier otro método responde 405. El servidor decide sesión, empresa, permiso y sucursal;
// el id es lo único que viene de la URL. Nunca se cachea ni se genera al compilar.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _pedido: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return descargarElPdf(id);
}
