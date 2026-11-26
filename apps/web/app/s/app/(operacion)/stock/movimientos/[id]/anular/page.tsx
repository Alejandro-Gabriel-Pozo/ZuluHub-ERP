import { pantallaDeMovimiento } from "../../../../../../../../pantallas/pantalla-de-movimiento";

type PropsDePagina = Readonly<{ params: Promise<{ id: string }> }>;

// `/stock/movimientos/[id]/anular`: el detalle de la anulación (maqueta `stock.html`, 09/11/2026). El identificador de la dirección es lo único que viene del navegador: el servidor valida que el movimiento sea
// de la empresa, esté en el alcance y sea anulable al enviar.
export default async function PaginaDeAnular({ params }: PropsDePagina) {
  const { id } = await params;
  return pantallaDeMovimiento("ANULAR", id);
}
