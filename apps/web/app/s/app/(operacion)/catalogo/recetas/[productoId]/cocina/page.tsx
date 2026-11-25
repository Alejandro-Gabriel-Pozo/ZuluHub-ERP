import { errorDeCodigo } from "../../../../../../../../../../src/capacidades/experiencia/respuesta";
import { pantallaDeOperacion } from "../../../../../../../../pantallas/operacion";
import { cargarLaFichaDeCocina, cargarLaReceta } from "../../../../../../../../servidor/recetas";
import { ErrorDelDetalle } from "../../../../../../../../ui/patrones/ErrorDelDetalle";
import { armarLaCocina } from "../../../../../../../../ui/plantillas/recetas/modelo-de-receta";
import { PantallaDeFichaDeCocina } from "../../../../../../../../ui/plantillas/recetas/PantallaDeFichaDeCocina";

type PropsDePagina = Readonly<{ params: Promise<{ productoId: string }> }>;

// `/catalogo/recetas/[productoId]/cocina`: la ficha de cocina de la receta vigente (maqueta `receta.html`, 15/11/2026): cantidades brutas y pasos, SIN costos ni precios (la consulta no los
// trae). Un producto sin receta, ajeno o mal escrito sale como el genérico. Solo lectura, sin «Imprimir». El permiso (`stock.ver`) y el módulo apagado los decide la consulta.
export default async function PaginaDeLaFichaDeCocina({ params }: PropsDePagina) {
  const { productoId } = await params;
  return pantallaDeOperacion({ titulo: "receta.ficha_de_cocina.titulo" }, async ({ contexto }) => {
    const cocina = await cargarLaFichaDeCocina(contexto, productoId);
    if (!cocina.ok) return <ErrorDelDetalle error={cocina.error} />;
    const receta = await cargarLaReceta(contexto, productoId);
    if (!receta.ok) return <ErrorDelDetalle error={receta.error} />;
    if (cocina.dato === null || receta.dato === null) {
      return <ErrorDelDetalle error={errorDeCodigo("RECETA_ACCION_NO_PERMITIDA")} />;
    }
    return (
      <PantallaDeFichaDeCocina cocina={armarLaCocina(receta.dato.producto.nombre, cocina.dato)} />
    );
  });
}
