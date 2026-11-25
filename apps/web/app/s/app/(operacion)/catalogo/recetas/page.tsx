import { pantallaDeOperacion } from "../../../../../../pantallas/operacion";
import { cargarLasRecetas } from "../../../../../../servidor/recetas";
import { ErrorDelDetalle } from "../../../../../../ui/patrones/ErrorDelDetalle";
import {
  leerElFiltroDeRecetas,
  leerLaPaginaDeRecetas,
} from "../../../../../../ui/plantillas/recetas/filtros-de-recetas";
import { armarLaListaDeRecetas } from "../../../../../../ui/plantillas/recetas/modelo-de-recetas";
import { PantallaDeListaDeRecetas } from "../../../../../../ui/plantillas/recetas/PantallaDeListaDeRecetas";

type PropsDePagina = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

// `/catalogo/recetas`: la lista de recetas de la empresa, con y sin receta (maqueta `receta.html`, 15/11/2026). Solo lectura. El filtro («Todas» / «Sin receta») y la página viajan en la
// dirección; la empresa y la persona las pone el servidor, y el permiso (`stock.ver`), los costos (`costos.ver`, solo gerente y administrador) y el módulo apagado los decide la consulta.
export default async function PaginaDeRecetas({ searchParams }: PropsDePagina) {
  const params = await searchParams;
  return pantallaDeOperacion({ titulo: "receta.pantalla.recetas" }, async ({ contexto }) => {
    const filtro = leerElFiltroDeRecetas(params);
    const respuesta = await cargarLasRecetas(contexto, {
      texto: "",
      conReceta: filtro,
      activo: "",
      despues: leerLaPaginaDeRecetas(params),
    });
    return (
      <PantallaDeListaDeRecetas
        lista={
          respuesta.ok
            ? armarLaListaDeRecetas(
                { recetas: respuesta.dato.recetas, siguiente: respuesta.dato.siguiente },
                filtro,
              )
            : null
        }
        error={respuesta.ok ? null : <ErrorDelDetalle error={respuesta.error} />}
      />
    );
  });
}
