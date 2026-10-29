import { errorDeCodigo } from "../../../../../../../../../src/capacidades/experiencia/respuesta";
import { FORMA_DE_ID } from "../../../../../../../pantallas/comprobante-por-id";
import { conTitulo, pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { verElComprobante } from "../../../../../../../servidor/facturacion";
import { puedeEmitirNotasDeCredito } from "../../../../../../../servidor/modulos";
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
// crédito» si la persona puede (acción de emitir notas de crédito, también con el módulo en solo lectura) y el comprobante es una
// factura o una nota de débito: habilitado si está Autorizada, apagado con su motivo si no (D-10, D-70). A una nota de crédito, nunca.
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
    // A una nota de crédito no se le ofrece nada (ni se pregunta por los permisos); a los demás, solo si la persona puede emitir notas.
    const puedeAnular =
      porQueNoSeAnula(dato) !== "FISCAL_ASOCIADO_NO_ASOCIABLE" &&
      (await puedeEmitirNotasDeCredito(contexto));
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
