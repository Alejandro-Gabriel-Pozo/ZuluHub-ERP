import { errorDeCodigo } from "../../../../../../../../../../src/capacidades/experiencia/respuesta";
import { LIMITES_DE_COMPROBANTE } from "../../../../../../../../../../src/modulos/fiscal/publico";
import { FORMA_DE_ID } from "../../../../../../../../pantallas/comprobante-por-id";
import { pantallaDeOperacion } from "../../../../../../../../pantallas/operacion";
import { verElComprobante } from "../../../../../../../../servidor/facturacion";
import { puedeEmitirNotasDeCredito } from "../../../../../../../../servidor/modulos";
import { ErrorDelDetalle } from "../../../../../../../../ui/plantillas/facturacion/ErrorDelDetalle";
import { aFacturaParaAnular } from "../../../../../../../../ui/plantillas/facturacion/eleccion-de-anulacion";
import { porQueNoSeAnula } from "../../../../../../../../ui/plantillas/facturacion/modelo-de-anulacion";
import { PantallaDeAnularComprobante } from "../../../../../../../../ui/plantillas/facturacion/PantallaDeAnularComprobante.cliente";
import { emitirNotaDeCreditoAccion } from "../../../../../acciones-de-facturacion";

// Anular es parte del módulo: «Comprobantes» queda marcado en la barra. El título (el único `h1`) es el de la pantalla.
const OPCIONES = { titulo: "fiscal.pantalla.anular_titulo", actual: "comprobantes" } as const;

// `/facturacion/comprobantes/[id]/anular`: emitir una nota de crédito sobre una factura o una nota de débito Autorizada, por el total
// o por importe en cada alícuota (D-69, D-70). La pantalla solo se ofrece a quien puede (acción `notas_de_credito.emitir`, también con el módulo en
// solo lectura) y arma los renglones; el servidor vuelve a validar todo dentro de la transacción de la acción. El id es lo único que
// viene de la URL.
export default async function PaginaDeAnularComprobante({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return pantallaDeOperacion(OPCIONES, async ({ contexto }) => {
    if (!FORMA_DE_ID.test(id)) {
      return <ErrorDelDetalle error={errorDeCodigo("FISCAL_COMPROBANTE_NO_ENCONTRADO")} />;
    }
    if (!(await puedeEmitirNotasDeCredito(contexto))) {
      return <ErrorDelDetalle error={errorDeCodigo("SIN_PERMISO")} />;
    }
    const respuesta = await verElComprobante({ comprobanteId: id });
    if (!respuesta.ok) return <ErrorDelDetalle error={respuesta.error} />;
    const noSeAnula = porQueNoSeAnula(respuesta.dato);
    if (noSeAnula !== null) return <ErrorDelDetalle error={errorDeCodigo(noSeAnula)} />;
    return (
      <PantallaDeAnularComprobante
        factura={aFacturaParaAnular(respuesta.dato)}
        limiteDelMotivo={LIMITES_DE_COMPROBANTE.motivo}
        emitir={emitirNotaDeCreditoAccion}
      />
    );
  });
}
