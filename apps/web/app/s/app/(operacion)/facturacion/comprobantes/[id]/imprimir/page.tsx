import { errorDeCodigo } from "../../../../../../../../../../src/capacidades/experiencia/respuesta";
import { FORMA_DE_ID } from "../../../../../../../../pantallas/comprobante-por-id";
import { comprobanteParaLaHoja } from "../../../../../../../../pantallas/modelo-de-impresion";
import { pantallaDeOperacion } from "../../../../../../../../pantallas/operacion";
import { verElModeloDeImpresion } from "../../../../../../../../servidor/facturacion";
import { direccionDelPdf } from "../../../../../../../../ui/plantillas/facturacion/filtros-del-listado";
import { ErrorDelDetalle } from "../../../../../../../../ui/patrones/ErrorDelDetalle";
import { PantallaDeImprimirComprobante } from "../../../../../../../../ui/plantillas/facturacion/PantallaDeImprimirComprobante.cliente";

// Imprimir es parte del módulo: «Comprobantes» queda marcado en la barra. El título (el único `h1`) es el del botón que lleva acá.
const OPCIONES = { titulo: "fiscal.pantalla.imprimir_boton", actual: "comprobantes" } as const;

// `/facturacion/comprobantes/[id]/imprimir`: la vista previa para imprimir un comprobante Autorizado (D-97). El servidor decide empresa,
// permiso y versión de representación; el id es lo único que viene de la URL. Todo error sale por el camino común del detalle.
export default async function PaginaDeImprimirComprobante({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return pantallaDeOperacion(OPCIONES, async () => {
    if (!FORMA_DE_ID.test(id)) {
      return <ErrorDelDetalle error={errorDeCodigo("FISCAL_COMPROBANTE_NO_ENCONTRADO")} />;
    }
    const respuesta = await verElModeloDeImpresion({ comprobanteId: id });
    if (!respuesta.ok) return <ErrorDelDetalle error={respuesta.error} />;
    return (
      <PantallaDeImprimirComprobante
        comprobante={comprobanteParaLaHoja(respuesta.dato.modelo)}
        qrSvg={respuesta.dato.qrSvg}
        urlDelPdf={direccionDelPdf(id)}
      />
    );
  });
}
