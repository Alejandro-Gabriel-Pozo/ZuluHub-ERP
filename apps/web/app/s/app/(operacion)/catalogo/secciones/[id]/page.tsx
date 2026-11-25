import { conTitulo, pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { puedeEditarProductos } from "../../../../../../../servidor/modulos";
import { cargarUnaSeccion } from "../../../../../../../servidor/secciones";
import { leerLaPagina } from "../../../../../../../ui/plantillas/catalogo/filtros-de-productos";
import { armarUnaSeccion } from "../../../../../../../ui/plantillas/catalogo/modelo-de-secciones";
import { PantallaDeUnaSeccion } from "../../../../../../../ui/plantillas/catalogo/PantallaDeUnaSeccion";
import { ErrorDelDetalle } from "../../../../../../../ui/patrones/ErrorDelDetalle";
import {
  desactivarSeccionAccion,
  quitarProductoDeSeccionAccion,
  reactivarSeccionAccion,
} from "../../../../acciones-de-secciones";

type PropsDePagina = Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

// `/catalogo/secciones/[id]`: una sección de la carta con sus productos activos, en orden alfabético (maqueta `productos-secciones.html`, 12/11/2026). El id de la dirección es lo
// único que viene del navegador: se busca entre las secciones de la empresa; una que no está ahí (ajena, inexistente, mal escrita) sale como el genérico y no dice cuál de los casos es. «Nombre»,
// «Desactivar», «Reactivar», «Agregar producto» y «Quitar» se ofrecen solo con `productos.editar` (`puedeEditarProductos`, cierra ante la duda). «Quitar» lleva ligados con `bind` los productos como se
// ven, con su versión (no viajan en un campo): con una versión vieja el servidor rechaza y la pantalla recarga.
export default async function PaginaDeUnaSeccion({ params, searchParams }: PropsDePagina) {
  const { id } = await params;
  const direccion = await searchParams;
  return pantallaDeOperacion({ titulo: "catalogo.seccion.titulo" }, async ({ contexto }) => {
    const respuesta = await cargarUnaSeccion(contexto, id, leerLaPagina(direccion));
    if (!respuesta.ok) return <ErrorDelDetalle error={respuesta.error} />;
    const seccion = armarUnaSeccion(respuesta.dato, await puedeEditarProductos(contexto));
    return conTitulo(
      seccion.titulo,
      <PantallaDeUnaSeccion
        seccion={seccion}
        accionDeEstado={(seccion.estado.reactivar
          ? reactivarSeccionAccion
          : desactivarSeccionAccion
        ).bind(null, seccion.id)}
        accionDeQuitar={quitarProductoDeSeccionAccion.bind(null, seccion.id, seccion.vistas)}
      />,
    );
  });
}
