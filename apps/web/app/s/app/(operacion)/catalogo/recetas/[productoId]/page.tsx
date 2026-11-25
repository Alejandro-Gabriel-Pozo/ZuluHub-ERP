import { errorDeCodigo } from "../../../../../../../../../src/capacidades/experiencia/respuesta";
import { conTitulo, pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { puedeEditarRecetas } from "../../../../../../../servidor/ofertas-de-stock";
import { cargarLaReceta } from "../../../../../../../servidor/recetas";
import { ErrorDelDetalle } from "../../../../../../../ui/patrones/ErrorDelDetalle";
import { armarLaReceta } from "../../../../../../../ui/plantillas/recetas/modelo-de-receta";
import { PantallaDeUnaReceta } from "../../../../../../../ui/plantillas/recetas/PantallaDeUnaReceta";

type PropsDePagina = Readonly<{ params: Promise<{ productoId: string }> }>;

// `/catalogo/recetas/[productoId]`: la receta vigente de un producto (maqueta `receta.html`, 15/11/2026). El id de la dirección es lo único que viene del navegador: un producto que no
// es de la empresa, no lleva receta o está mal escrito sale como el genérico y no dice cuál de los casos es. Un producto de la empresa sin receta dice «Este producto no tiene receta».
// Los costos salen solo con `costos.ver`. Solo lectura; sin entrada en el menú propia: se llega desde la lista.
export default async function PaginaDeUnaReceta({ params }: PropsDePagina) {
  const { productoId } = await params;
  return pantallaDeOperacion({ titulo: "receta.pantalla.recetas" }, async ({ contexto }) => {
    const respuesta = await cargarLaReceta(contexto, productoId);
    if (!respuesta.ok) return <ErrorDelDetalle error={respuesta.error} />;
    if (respuesta.dato === null) {
      return <ErrorDelDetalle error={errorDeCodigo("RECETA_ACCION_NO_PERMITIDA")} />;
    }
    const receta = armarLaReceta(respuesta.dato, { editar: await puedeEditarRecetas(contexto) });
    return conTitulo(receta.titulo, <PantallaDeUnaReceta receta={receta} />);
  });
}
