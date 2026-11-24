import { pantallaDeOperacion, conTitulo } from "../../../../../../../pantallas/operacion";
import { cargarLaFichaDelProveedor } from "../../../../../../../servidor/ficha-de-proveedor";
import { accionesDeLaFichaDelProveedor } from "../../../../../../../servidor/acciones-de-la-ficha-del-proveedor";
import { ErrorDelDetalle } from "../../../../../../../ui/patrones/ErrorDelDetalle";
import { PantallaDeFichaDeProveedor } from "../../../../../../../ui/plantillas/compras/proveedor/PantallaDeFichaDeProveedor";
import { textosDeProveedor } from "../../../../../../../ui/plantillas/compras/proveedor/textos-de-proveedor";
import {
  agregarComprobanteAccion,
  agregarPuntoDeVentaAccion,
  dejarDeUsarComprobanteAccion,
  dejarDeUsarPuntoDeVentaAccion,
  pedirComprobanteAccion,
  pedirPuntoDeVentaAccion,
  resolverPedidoAccion,
} from "../../../../acciones-de-ficha-de-proveedor";

// `/compras/proveedores/[id]`: la ficha del proveedor de compras (maqueta `compra.html`, estado `proveedor`). El id es lo único que viene de la dirección: la empresa, la persona y los permisos los decide el
// servidor. Un id mal escrito, de otra empresa o de una parte que no es proveedor sale igual (no se distingue). Mirar no escribe. Los botones de editar o de pedir se ofrecen según el permiso y cada
// acción vuelve a verificarlo en el servidor; el proveedor, el número, el tipo y el pedido se ligan con `.bind` (Next los cifra): no viajan en un campo.
export default async function PaginaDeLaFichaDelProveedor({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return pantallaDeOperacion({ titulo: "compras.compra.compras" }, async ({ contexto }) => {
    const respuesta = await cargarLaFichaDelProveedor(contexto, id);
    if (!respuesta.ok) return <ErrorDelDetalle error={respuesta.error} />;
    const ficha = respuesta.dato;
    return conTitulo(
      ficha.nombre ?? "—",
      <PantallaDeFichaDeProveedor
        ficha={ficha}
        permisos={await accionesDeLaFichaDelProveedor(contexto)}
        textos={textosDeProveedor()}
        acciones={{
          agregarPuntoDeVenta: agregarPuntoDeVentaAccion.bind(null, ficha.parteId),
          pedirPuntoDeVenta: pedirPuntoDeVentaAccion.bind(null, ficha.parteId),
          agregarComprobante: agregarComprobanteAccion.bind(null, ficha.parteId),
          pedirComprobante: pedirComprobanteAccion.bind(null, ficha.parteId),
          dejarDeUsarPuntoDeVenta: (numero) =>
            dejarDeUsarPuntoDeVentaAccion.bind(null, ficha.parteId, numero),
          dejarDeUsarComprobante: (tipo) =>
            dejarDeUsarComprobanteAccion.bind(null, ficha.parteId, tipo),
          resolverPedido: (pedidoId, decision) =>
            resolverPedidoAccion.bind(null, pedidoId, decision),
        }}
      />,
    );
  });
}
