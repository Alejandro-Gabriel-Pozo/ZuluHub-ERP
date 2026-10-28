import { errorDeCodigo } from "../../../../../../../../../src/capacidades/experiencia/respuesta";
import { pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { verElComprobante } from "../../../../../../../servidor/facturacion";
import { ErrorDelDetalle } from "../../../../../../../ui/plantillas/facturacion/ErrorDelDetalle";
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
  return pantallaDeOperacion(
    { titulo: "fiscal.pantalla.titulo", actual: "facturacion" },
    async () => {
      if (!FORMA_DE_ID.test(id)) {
        return <ErrorDelDetalle error={errorDeCodigo("FISCAL_COMPROBANTE_NO_ENCONTRADO")} />;
      }
      const respuesta = await verElComprobante({ comprobanteId: id });
      return respuesta.ok ? (
        <PantallaDeDetalleDeComprobante detalle={respuesta.dato} />
      ) : (
        <ErrorDelDetalle error={respuesta.error} />
      );
    },
  );
}
