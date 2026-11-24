import { pantallaDeOperacion, conTitulo } from "../../../../../../pantallas/operacion";
import { cargarLaFichaDeCompra } from "../../../../../../servidor/compras";
import { ErrorDelDetalle } from "../../../../../../ui/patrones/ErrorDelDetalle";
import { PantallaDeFichaDeCompra } from "../../../../../../ui/plantillas/compras/ficha/PantallaDeFichaDeCompra";
import { textosDeCompras } from "../../../../../../ui/plantillas/compras/textos-de-compras";

// `/compras/[id]`: la ficha de una compra, solo lectura (maqueta `compra-corregir-anular.html`, `vFicha`). El id es lo único que viene de la URL: la empresa, la persona y el alcance de sucursal los
// decide el servidor. Un id mal escrito, de otra empresa o de otra sucursal sale igual que uno que no existe (el genérico): no se distingue. Sin acciones de Next: no hay formularios que envíen.
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
      <PantallaDeFichaDeCompra ficha={ficha.dato} textos={textos} />,
    );
  });
}
