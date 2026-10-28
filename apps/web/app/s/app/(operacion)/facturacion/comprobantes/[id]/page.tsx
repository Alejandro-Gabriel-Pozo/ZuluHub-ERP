import { errorDeCodigo } from "../../../../../../../../../src/capacidades/experiencia/respuesta";
import { conTitulo, pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { verElComprobante } from "../../../../../../../servidor/facturacion";
import { ErrorDelDetalle } from "../../../../../../../ui/plantillas/facturacion/ErrorDelDetalle";
import { armarElDetalle } from "../../../../../../../ui/plantillas/facturacion/modelo-del-detalle";
import { PantallaDeDetalleDeComprobante } from "../../../../../../../ui/plantillas/facturacion/PantallaDeDetalleDeComprobante";

// Mismo formato que valida el servidor: si el id de la URL no lo tiene, ni se pregunta (es «no encontrado»).
const FORMA_DE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Detalle de un comprobante (solo lectura). El servidor decide empresa y permiso; el id es lo único que viene de la URL.
export default async function PaginaDeDetalleDeComprobante({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return pantallaDeOperacion({ titulo: "fiscal.pantalla.titulo" }, async () => {
    if (!FORMA_DE_ID.test(id)) {
      return <ErrorDelDetalle error={errorDeCodigo("FISCAL_COMPROBANTE_NO_ENCONTRADO")} />;
    }
    const respuesta = await verElComprobante({ comprobanteId: id });
    if (!respuesta.ok) return <ErrorDelDetalle error={respuesta.error} />;
    // El título real es el único h1 (el de un error sigue siendo el genérico del catálogo).
    return conTitulo(
      armarElDetalle(respuesta.dato, {}).titulo,
      <PantallaDeDetalleDeComprobante detalle={respuesta.dato} />,
    );
  });
}
