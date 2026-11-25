import { pantallaDeOperacion, conTitulo } from "../../../../../../../pantallas/operacion";
import {
  accionesDeLaFactura,
  cargarLaFichaDeFactura,
  cargarLasSucursalesConNombre,
} from "../../../../../../../servidor/facturas";
import { ErrorDelDetalle } from "../../../../../../../ui/patrones/ErrorDelDetalle";
import { PantallaDeDetalleDeFactura } from "../../../../../../../ui/plantillas/compras/facturas/PantallaDeDetalleDeFactura";
import { nombreDeLaFacturaDeLaEmpresa } from "../../../../../../../ui/plantillas/compras/facturas/modelo-de-facturas";
import { textosDeFacturas } from "../../../../../../../ui/plantillas/compras/facturas/textos-de-facturas";
import { anularConciliacionAccion } from "../../../../acciones-de-facturas";

// `/compras/facturas/[id]`: el detalle de una factura de la empresa (maqueta `compra-conciliar.html`, estados «Falta conciliar» y «Conciliada en parte»). El id es lo único que viene de la URL: la empresa, la persona
// y el alcance de sucursal los decide el servidor. Un id mal escrito o de otra empresa sale igual que uno que no existe (el genérico). Lo recibido se muestra solo de las sucursales del alcance. «Conciliar» y
// «Anular conciliación» se ofrecen con el permiso (gerente y administrador); el servidor los vuelve a verificar al actuar; la factura y la conciliación las liga la página con `.bind`.
export default async function PaginaDelDetalleDeFactura({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return pantallaDeOperacion({ titulo: "compras.factura.titulo_lista" }, async ({ contexto }) => {
    const ficha = await cargarLaFichaDeFactura(contexto, id);
    if (!ficha.ok) return <ErrorDelDetalle error={ficha.error} />;
    const acciones = await accionesDeLaFactura(contexto);
    return conTitulo(
      nombreDeLaFacturaDeLaEmpresa(ficha.dato),
      <PantallaDeDetalleDeFactura
        ficha={ficha.dato}
        textos={textosDeFacturas()}
        sucursales={await cargarLasSucursalesConNombre(contexto)}
        acciones={acciones}
        accionesDeAnular={Object.fromEntries(
          ficha.dato.conciliaciones.map((c) => [
            c.conciliacionId,
            anularConciliacionAccion.bind(null, ficha.dato.comprobanteId, c.conciliacionId),
          ]),
        )}
      />,
    );
  });
}
