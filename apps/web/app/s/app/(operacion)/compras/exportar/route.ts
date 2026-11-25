import { descargarElArchivoDeCompras } from "../../../../../../pantallas/descarga-de-compras";

// `/compras/exportar?desde=AAAA-MM-DD&hasta=AAAA-MM-DD`: el archivo de Excel de compras del período, como descarga. Solo GET (y HEAD, que Next deriva de él: pasa por la misma
// autorización y no manda cuerpo); cualquier otro método responde 405. El servidor decide sesión, empresa, permisos y sucursales; del pedido solo se leen las dos fechas. Nunca se cachea ni se
// genera al compilar. Cada descarga deja su registro de auditoría (quién, cuándo, período y cantidad de filas).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Tope de la función: 30 s. Lee hasta 20.000 filas en una transacción y escribe el archivo en memoria; no llama a nadie de afuera. El número es un supuesto con margen hasta medirlo en la
// base real de preview (la medición del PR dice cuánto tardó en la base local).
// Next: `maxDuration` en un route.ts. Chequeo: `test/web/max-duration.test.ts`.
export const maxDuration = 30;

export async function GET(pedido: Request): Promise<Response> {
  return descargarElArchivoDeCompras(new URL(pedido.url).searchParams);
}
