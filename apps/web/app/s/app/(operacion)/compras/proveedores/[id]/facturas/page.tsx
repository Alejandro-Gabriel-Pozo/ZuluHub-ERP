import { pantallaDeOperacion } from "../../../../../../../../pantallas/operacion";
import { cargarLaFichaDelProveedor } from "../../../../../../../../servidor/ficha-de-proveedor";
import { ErrorDelDetalle } from "../../../../../../../../ui/patrones/ErrorDelDetalle";
import { PantallaDeFacturasDelProveedor } from "../../../../../../../../ui/plantillas/compras/proveedor/PantallaDeFacturasDelProveedor";
import { textosDeProveedor } from "../../../../../../../../ui/plantillas/compras/proveedor/textos-de-proveedor";

// `/compras/proveedores/[id]/facturas`: todas las facturas y notas del proveedor («Ver todas»; maqueta `compra.html`, estado `facturas-prov`). Solo lectura: sin acciones de Next. El id es lo único que
// viene de la dirección; un proveedor ajeno o inexistente sale como el genérico.
export default async function PaginaDeLasFacturasDelProveedor({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return pantallaDeOperacion({ titulo: "compras.ficha.facturas_y_notas" }, async ({ contexto }) => {
    const respuesta = await cargarLaFichaDelProveedor(contexto, id);
    if (!respuesta.ok) return <ErrorDelDetalle error={respuesta.error} />;
    return <PantallaDeFacturasDelProveedor ficha={respuesta.dato} textos={textosDeProveedor()} />;
  });
}
