import { pantallaDeOperacion } from "../../../../../../pantallas/operacion";
import { puedeAbrirOrdenes } from "../../../../../../servidor/ofertas-de-produccion";
import { cargarLasOrdenes } from "../../../../../../servidor/produccion";
import { ErrorDelDetalle } from "../../../../../../ui/patrones/ErrorDelDetalle";
import { leerElFiltroDeEstado } from "../../../../../../ui/plantillas/produccion/filtros-de-ordenes";
import { armarLaLista } from "../../../../../../ui/plantillas/produccion/modelo-de-ordenes";
import { PantallaDeListaDeOrdenes } from "../../../../../../ui/plantillas/produccion/PantallaDeListaDeOrdenes";

type PropsDePagina = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

// `/catalogo/produccion`: la lista de órdenes de producción de la sucursal elegida, también las cerradas, canceladas y anuladas (maqueta `produccion.html`, 09/11/2026). Solo lectura. El
// filtro («Todas» / «Abiertas») viaja en la dirección; la empresa, la persona y la sucursal las pone el servidor, y el permiso (`transformaciones.ver`) y el módulo en desarrollo los
// decide la consulta. Todo nace cerrado: el módulo `produccion` sigue «en desarrollo» y la pantalla no se ofrece en el menú hasta que el dueño lo pase a disponible.
export default async function PaginaDeProduccion({ searchParams }: PropsDePagina) {
  const params = await searchParams;
  return pantallaDeOperacion({ titulo: "produccion.pantalla.produccion" }, async ({ contexto }) => {
    const estado = leerElFiltroDeEstado(params);
    const respuesta = await cargarLasOrdenes(contexto, { estado });
    return (
      <PantallaDeListaDeOrdenes
        lista={
          respuesta.ok
            ? armarLaLista(respuesta.dato, estado, {}, { abrir: await puedeAbrirOrdenes(contexto) })
            : null
        }
        error={respuesta.ok ? null : <ErrorDelDetalle error={respuesta.error} />}
      />
    );
  });
}
