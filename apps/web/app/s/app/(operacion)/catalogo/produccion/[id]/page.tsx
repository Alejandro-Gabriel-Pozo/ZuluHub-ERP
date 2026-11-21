import { conTitulo, pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { accionesDeProduccion } from "../../../../../../../servidor/ofertas-de-produccion";
import { cargarLaOrden } from "../../../../../../../servidor/produccion";
import { ErrorDelDetalle } from "../../../../../../../ui/patrones/ErrorDelDetalle";
import { armarLaOrden } from "../../../../../../../ui/plantillas/produccion/modelo-de-orden";
import { PantallaDeLaOrden } from "../../../../../../../ui/plantillas/produccion/PantallaDeLaOrden";
import { anularOrdenAccion, cancelarOrdenAccion } from "../../../../acciones-de-produccion";

type PropsDePagina = Readonly<{ params: Promise<{ id: string }> }>;

// `/catalogo/produccion/[id]`: la ficha de una orden de producción (maqueta `produccion.html`, 09/11/2026) con «Cancelar la orden» (si está abierta) y «Anular la orden» (si está cerrada),
// ambas con motivo. El id de la dirección es lo único que viene del navegador: una orden que no está entre las de la empresa y del alcance de la persona (ajena, inexistente, mal escrita)
// sale como el genérico y no dice cuál de los casos es. Los botones se ofrecen solo si el servidor deja hacerlos (`accionesDeProduccion`, cierra ante la duda); cada acción vuelve a
// pasar por el guard. Sin entrada en el menú: se llega desde la lista. El permiso (`transformaciones.ver`) y el módulo en desarrollo los decide la consulta.
export default async function PaginaDeLaOrden({ params }: PropsDePagina) {
  const { id } = await params;
  return pantallaDeOperacion({ titulo: "produccion.pantalla.produccion" }, async ({ contexto }) => {
    const respuesta = await cargarLaOrden(contexto, id);
    if (!respuesta.ok) return <ErrorDelDetalle error={respuesta.error} />;
    const orden = armarLaOrden(respuesta.dato, await accionesDeProduccion(contexto));
    return conTitulo(
      orden.titulo,
      <PantallaDeLaOrden
        key={`${respuesta.dato.id}-${respuesta.dato.estado}`}
        orden={orden}
        cancelar={cancelarOrdenAccion.bind(null, respuesta.dato.id)}
        anular={anularOrdenAccion.bind(null, respuesta.dato.id)}
      />,
    );
  });
}
