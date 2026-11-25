import { pantallaDeOperacion } from "../../../../../../pantallas/operacion";
import { accionesDeLaFactura, cargarLasFacturas } from "../../../../../../servidor/facturas";
import { ErrorDelDetalle } from "../../../../../../ui/patrones/ErrorDelDetalle";
import { PantallaDeListaDeFacturas } from "../../../../../../ui/plantillas/compras/facturas/PantallaDeListaDeFacturas";
import { textosDeFacturas } from "../../../../../../ui/plantillas/compras/facturas/textos-de-facturas";

// `/compras/facturas`: las facturas de la empresa (maqueta `compra-conciliar.html`, estado `lista`). Una factura no tiene sucursal; la lectura exige `comprobantes_de_proveedor.ver`; lo que no se puede mostrar (sin
// permiso, cursor mal formado) sale como el genérico: nunca una lista que parezca completa. La dirección solo aporta el cursor (`despues`). Sin filtros en la primera versión.
export default async function PaginaDeFacturas({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parametros = await searchParams;
  return pantallaDeOperacion({ titulo: "compras.factura.titulo_lista" }, async ({ contexto }) => {
    const lista = await cargarLasFacturas(contexto, parametros);
    if (!lista.ok) return <ErrorDelDetalle error={lista.error} />;
    return (
      <PantallaDeListaDeFacturas
        lista={lista.dato}
        textos={textosDeFacturas()}
        puedeCargar={(await accionesDeLaFactura(contexto)).cargar}
      />
    );
  });
}
