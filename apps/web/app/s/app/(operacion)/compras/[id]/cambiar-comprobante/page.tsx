import { errorDeCodigo } from "../../../../../../../../../src/capacidades/experiencia/respuesta";
import { pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { cargarLaFichaDeCompra } from "../../../../../../../servidor/compras";
import {
  accionesDelReemplazo,
  cargarLoQueHayQueDeshacerAntesDeCambiar,
} from "../../../../../../../servidor/reemplazo";
import { ErrorDelDetalle } from "../../../../../../../ui/patrones/ErrorDelDetalle";
import {
  pasosPrevios,
  renglonesDeLaCompra,
} from "../../../../../../../ui/plantillas/compras/reemplazo/modelo-de-reemplazo";
import { FormularioDeReemplazar } from "../../../../../../../ui/plantillas/compras/reemplazo/FormularioDeReemplazar.cliente";
import { PantallaDeReemplazo } from "../../../../../../../ui/plantillas/compras/reemplazo/PantallaDeReemplazo";
import { textosDeReemplazo } from "../../../../../../../ui/plantillas/compras/reemplazo/textos-de-reemplazo";
import { buscarProductosAccion, cotizarFacturaAccion } from "../../../../acciones-de-comprar";
import { cambiarElComprobanteAccion } from "../../../../acciones-de-reemplazo";

// `/compras/[id]/cambiar-comprobante`: «Cambiar el comprobante de la compra» (N1/N2; maqueta de Diseño 2, pantalla 11). El id de la compra es lo único que viene de la dirección. La factura que se está mirando la fija la lectura del
// servidor (`facturaVigenteVistaId`: si otra persona la cambia antes, el servidor no escribe nada); las líneas de la factura nueva son los renglones de la compra, no se eligen. Lo recibido y su costo no se tocan. Nace cerrada: sin
// los permisos de reemplazar, anular y registrar no hay pantalla (y el servidor lo vuelve a verificar al enviar).
export default async function PaginaDeCambiarElComprobante({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return pantallaDeOperacion({ titulo: "compras.reemplazo.titulo" }, async ({ contexto }) => {
    const previo = await cargarLoQueHayQueDeshacerAntesDeCambiar(contexto, id);
    if (!previo.ok) return <ErrorDelDetalle error={previo.error} />;
    const ficha = await cargarLaFichaDeCompra(contexto, id);
    if (!ficha.ok) return <ErrorDelDetalle error={ficha.error} />;
    // La factura de la ficha y la de la lectura tienen que ser la misma: si cambió entre las dos lecturas no se ofrece nada (se vuelve a abrir).
    if (previo.dato.anulada || ficha.dato.factura?.comprobanteId !== previo.dato.comprobanteId) {
      return <ErrorDelDetalle error={errorDeCodigo("COMPRAS_ACCION_NO_PERMITIDA")} />;
    }
    const textos = textosDeReemplazo();
    const pasos = pasosPrevios(
      previo.dato.frenos,
      { facturaId: previo.dato.comprobanteId, recepcionId: ficha.dato.recepcionId },
      await accionesDelReemplazo(contexto),
    );
    return (
      <PantallaDeReemplazo pasos={pasos} textos={textos}>
        <FormularioDeReemplazar
          textos={textos}
          que={{
            tipo: "COMPRA",
            recepcionId: ficha.dato.recepcionId,
            facturaVigenteVistaId: previo.dato.comprobanteId,
            renglones: renglonesDeLaCompra(ficha.dato.lineas),
          }}
          importeOriginal={ficha.dato.factura.totalSegunLaFactura.monto}
          conPasosPendientes={pasos.length > 0}
          buscarProductos={buscarProductosAccion}
          cotizarFactura={cotizarFacturaAccion}
          enviar={cambiarElComprobanteAccion}
        />
      </PantallaDeReemplazo>
    );
  });
}
