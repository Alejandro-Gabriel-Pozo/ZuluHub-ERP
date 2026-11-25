import { pantallaDeOperacion } from "../../../../../../../../pantallas/operacion";
import {
  cargarLasSucursalesConNombre,
  cargarLosDatosParaConciliar,
} from "../../../../../../../../servidor/facturas";
import { ErrorDelDetalle } from "../../../../../../../../ui/patrones/ErrorDelDetalle";
import { PantallaDeConciliar } from "../../../../../../../../ui/plantillas/compras/facturas/PantallaDeConciliar.cliente";
import { textosDeFacturas } from "../../../../../../../../ui/plantillas/compras/facturas/textos-de-facturas";
import { conciliarFacturaAccion } from "../../../../../acciones-de-facturas";

// `/compras/facturas/[id]/conciliar`: repartir la factura entre lo recibido por sucursal (maqueta `compra-conciliar.html`, estado `conciliar`). El id es lo único que viene de la URL. La propuesta y lo recibido se
// limitan a las sucursales del alcance de quien concilia (hoy gerente y administrador tienen alcance «TODAS», H6). Sin permiso para conciliar la pantalla no se abre (el genérico): nace cerrada; el guard de la acción vuelve a
// decidir. Una factura que no existe o es de otra empresa sale igual (el genérico).
export default async function PaginaDeConciliar({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return pantallaDeOperacion({ titulo: "compras.conciliacion.conciliar" }, async ({ contexto }) => {
    const datos = await cargarLosDatosParaConciliar(contexto, id);
    if (!datos.ok) return <ErrorDelDetalle error={datos.error} />;
    const textos = textosDeFacturas();
    return (
      <PantallaDeConciliar
        comprobanteId={id}
        datos={datos.dato}
        sucursales={await cargarLasSucursalesConNombre(contexto)}
        conciliar={conciliarFacturaAccion}
        textos={{
          recepcion: textos.recepcion,
          recibido: textos.recibido,
          facturado: textos.facturado,
          aConciliar: textos.aConciliar,
          validarConciliacion: textos.validarConciliacion,
          enviando: textos.enviando,
          reintentar: textos.reintentar,
        }}
      />
    );
  });
}
