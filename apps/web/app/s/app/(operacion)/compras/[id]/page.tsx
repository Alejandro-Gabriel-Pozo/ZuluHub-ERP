import { pantallaDeOperacion, conTitulo } from "../../../../../../pantallas/operacion";
import { cargarLaFichaDeCompra } from "../../../../../../servidor/compras";
import { accionesDeLaCompra } from "../../../../../../servidor/ofertas-de-compras";
import { ErrorDelDetalle } from "../../../../../../ui/patrones/ErrorDelDetalle";
import { PantallaDeFichaDeCompra } from "../../../../../../ui/plantillas/compras/ficha/PantallaDeFichaDeCompra";
import { textosDeCompras } from "../../../../../../ui/plantillas/compras/textos-de-compras";
import { anularCompraAccion } from "../../../acciones-de-correccion-de-compra";
import { anularElPagoAccion } from "../../../acciones-de-pago-de-factura";

// `/compras/[id]`: la ficha de una compra, solo lectura (maqueta `compra-corregir-anular.html`, `vFicha`). El id es lo único que viene de la URL: la empresa, la persona y el alcance de sucursal los
// decide el servidor. Un id mal escrito, de otra empresa o de otra sucursal sale igual que uno que no existe (el genérico): no se distingue. «Corregir» (por línea) y «Anular» (al pie) se ofrecen según el
// permiso (gerente y administrador); lo mismo «Declarar pago» y «Anular» el pago de la factura (Compras PR 8) y el servidor los vuelve a verificar al actuar; la compra que se anula la liga la página con `.bind`.
export default async function PaginaDeLaFichaDeCompra({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return pantallaDeOperacion({ titulo: "compras.compra.compras" }, async ({ contexto }) => {
    const ficha = await cargarLaFichaDeCompra(contexto, id);
    if (!ficha.ok) return <ErrorDelDetalle error={ficha.error} />;
    const textos = textosDeCompras();
    return conTitulo(
      `${textos.compra} ${String(ficha.dato.numero)}`,
      <PantallaDeFichaDeCompra
        ficha={ficha.dato}
        textos={textos}
        acciones={await accionesDeLaCompra(contexto)}
        accionDeAnular={anularCompraAccion.bind(null, ficha.dato.recepcionId)}
        accionDeAnularPago={(pagoId) =>
          anularElPagoAccion.bind(null, ficha.dato.recepcionId, pagoId)
        }
      />,
    );
  });
}
