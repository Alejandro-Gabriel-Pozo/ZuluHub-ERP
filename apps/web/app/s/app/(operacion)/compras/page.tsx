import { pantallaDeOperacion } from "../../../../../pantallas/operacion";
import { cargarLasCompras } from "../../../../../servidor/compras";
import { puedeLaAccion } from "../../../../../servidor/permisos-de-la-persona";
import { ErrorDelDetalle } from "../../../../../ui/patrones/ErrorDelDetalle";
import { PantallaDeListaDeCompras } from "../../../../../ui/plantillas/compras/lista/PantallaDeListaDeCompras";
import { textosDeCompras } from "../../../../../ui/plantillas/compras/textos-de-compras";

// `/compras`: las compras de la sucursal elegida en este dispositivo, solo lectura (maqueta `compra-corregir-anular.html`, `vLista`). La sucursal la fija el servidor y la lectura exige
// `recepciones.ver`; lo que no se puede mostrar (sin sucursal, sin permiso, cursor mal formado) sale como el genérico: nunca una lista que parezca completa. La dirección solo aporta
// el filtro (`estado`, `desde`, `hasta`) y el cursor (`despues`), y el servidor toma únicamente lo que declara.
export default async function PaginaDeCompras({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parametros = await searchParams;
  return pantallaDeOperacion({ titulo: "compras.compra.compras" }, async ({ contexto }) => {
    const lista = await cargarLasCompras(contexto, parametros);
    if (!lista.ok) return <ErrorDelDetalle error={lista.error} />;
    return (
      <PantallaDeListaDeCompras
        lista={lista.dato}
        textos={textosDeCompras()}
        puedeCargarUnaCompra={await puedeLaAccion(contexto, "recepciones.registrar")}
        puedeExportar={
          (await puedeLaAccion(contexto, "compras.exportar")) &&
          (await puedeLaAccion(contexto, "costos.ver"))
        }
      />
    );
  });
}
