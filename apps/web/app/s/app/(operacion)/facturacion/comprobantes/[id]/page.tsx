import { errorDeCodigo } from "../../../../../../../../../src/capacidades/experiencia/respuesta";
import { FORMA_DE_ID } from "../../../../../../../pantallas/comprobante-por-id";
import { conTitulo, pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { verElComprobante } from "../../../../../../../servidor/facturacion";
import { loQueFaltaParaAnular } from "../../../../../../../servidor/modulos";
import { ErrorDelDetalle } from "../../../../../../../ui/plantillas/facturacion/ErrorDelDetalle";
import {
  accionDeAnularDelDetalle,
  porQueNoSeAnula,
} from "../../../../../../../ui/plantillas/facturacion/modelo-de-anulacion";
import { armarElDetalle } from "../../../../../../../ui/plantillas/facturacion/modelo-del-detalle";
import { PantallaDeDetalleDeComprobante } from "../../../../../../../ui/plantillas/facturacion/PantallaDeDetalleDeComprobante";

// El detalle también es del módulo: «Comprobantes» queda marcado en la barra.
const OPCIONES = { titulo: "fiscal.pantalla.titulo", actual: "comprobantes" } as const;

// Detalle de un comprobante. El servidor decide empresa y permiso; el id es lo único que viene de la URL. Ofrece «Anular con nota de
// crédito» solo si la persona puede (acción de emitir notas de crédito y módulo activo) y el comprobante es una factura o una nota de
// débito Autorizada.
export default async function PaginaDeDetalleDeComprobante({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return pantallaDeOperacion(OPCIONES, async ({ contexto }) => {
    if (!FORMA_DE_ID.test(id)) {
      return <ErrorDelDetalle error={errorDeCodigo("FISCAL_COMPROBANTE_NO_ENCONTRADO")} />;
    }
    const respuesta = await verElComprobante({ comprobanteId: id });
    if (!respuesta.ok) return <ErrorDelDetalle error={respuesta.error} />;
    const dato = respuesta.dato;
    // Solo se pregunta por los permisos si el comprobante se puede anular: a los demás no se les ofrece nada.
    const puedeAnular =
      porQueNoSeAnula(dato) === null && (await loQueFaltaParaAnular(contexto)) === null;
    // El título real es el único h1 (el de un error sigue siendo el genérico del catálogo).
    return conTitulo(
      armarElDetalle(dato, {}).titulo,
      <PantallaDeDetalleDeComprobante
        detalle={dato}
        anular={accionDeAnularDelDetalle({}, dato, puedeAnular)}
      />,
    );
  });
}
