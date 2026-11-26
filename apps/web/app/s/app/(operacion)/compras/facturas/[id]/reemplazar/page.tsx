import { errorDeCodigo } from "../../../../../../../../../../src/capacidades/experiencia/respuesta";
import { pantallaDeOperacion } from "../../../../../../../../pantallas/operacion";
import { cargarLaFichaDeFactura } from "../../../../../../../../servidor/facturas";
import {
  accionesDelReemplazo,
  cargarLoQueHayQueDeshacerAntesDeReemplazar,
} from "../../../../../../../../servidor/reemplazo";
import { ErrorDelDetalle } from "../../../../../../../../ui/patrones/ErrorDelDetalle";
import { pasosPrevios } from "../../../../../../../../ui/plantillas/compras/reemplazo/modelo-de-reemplazo";
import { FormularioDeReemplazar } from "../../../../../../../../ui/plantillas/compras/reemplazo/FormularioDeReemplazar.cliente";
import { PantallaDeReemplazo } from "../../../../../../../../ui/plantillas/compras/reemplazo/PantallaDeReemplazo";
import { textosDeReemplazo } from "../../../../../../../../ui/plantillas/compras/reemplazo/textos-de-reemplazo";
import { buscarProductosAccion, cotizarFacturaAccion } from "../../../../../acciones-de-comprar";
import { reemplazarFacturaAccion } from "../../../../../acciones-de-reemplazo";

// `/compras/facturas/[id]/reemplazar`: «Reemplazar el comprobante» de una factura que llega sola (N3/N4; maqueta de Diseño 2, pantalla 11). El id es lo único que viene de la dirección; la empresa, la persona, el proveedor
// de la factura nueva (el de la original) y el alcance los decide el servidor. Nace cerrada: sin el permiso de reemplazar no hay pantalla (y el servidor lo vuelve a verificar al enviar). «Qué hay que deshacer antes» sale
// de la lectura del servidor; una factura ya anulada no se ofrece. La clave del envío la genera la pantalla por intento.
export default async function PaginaDeReemplazarUnaFactura({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return pantallaDeOperacion({ titulo: "compras.reemplazo.titulo" }, async ({ contexto }) => {
    const previo = await cargarLoQueHayQueDeshacerAntesDeReemplazar(contexto, id);
    if (!previo.ok) return <ErrorDelDetalle error={previo.error} />;
    if (previo.dato.anulada) {
      return <ErrorDelDetalle error={errorDeCodigo("COMPRAS_ACCION_NO_PERMITIDA")} />;
    }
    const ficha = await cargarLaFichaDeFactura(contexto, id);
    if (!ficha.ok) return <ErrorDelDetalle error={ficha.error} />;
    const textos = textosDeReemplazo();
    const pasos = pasosPrevios(
      previo.dato.frenos,
      { facturaId: id, recepcionId: null },
      await accionesDelReemplazo(contexto),
    );
    return (
      <PantallaDeReemplazo pasos={pasos} textos={textos}>
        <FormularioDeReemplazar
          textos={textos}
          que={{ tipo: "FACTURA", comprobanteId: id }}
          importeOriginal={ficha.dato.totalSegunFactura}
          conPasosPendientes={pasos.length > 0}
          buscarProductos={buscarProductosAccion}
          cotizarFactura={cotizarFacturaAccion}
          enviar={reemplazarFacturaAccion}
        />
      </PantallaDeReemplazo>
    );
  });
}
