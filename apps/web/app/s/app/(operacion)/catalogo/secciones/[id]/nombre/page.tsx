import { conTitulo, pantallaDeOperacion } from "../../../../../../../../pantallas/operacion";
import { puedeEditarProductos } from "../../../../../../../../servidor/modulos";
import { cargarLaSeccion } from "../../../../../../../../servidor/secciones";
import { FormularioDeSeccionDeCarta } from "../../../../../../../../ui/plantillas/catalogo/FormularioDeSeccionDeCarta.cliente";
import { armarElFormularioDeSeccion } from "../../../../../../../../ui/plantillas/catalogo/modelo-de-secciones";
import { ErrorDelDetalle } from "../../../../../../../../ui/patrones/ErrorDelDetalle";
import { renombrarSeccionAccion } from "../../../../../acciones-de-secciones";

type PropsDePagina = Readonly<{ params: Promise<{ id: string }> }>;

// `/catalogo/secciones/[id]/nombre`: renombrar una sección (maqueta `productos-secciones.html`, 12/11/2026): el mismo formulario del alta con el nombre actual. El id de la dirección es lo único
// que viene del navegador: una sección que no es de la empresa sale como el genérico. La acción lleva la versión que se vio: si otra persona la cambió antes, el servidor rechaza. «Guardar» sale
// apagado sin `productos.editar` (`puedeEditarProductos`, cierra ante la duda).
export default async function PaginaDelNombreDeUnaSeccion({ params }: PropsDePagina) {
  const { id } = await params;
  return pantallaDeOperacion({ titulo: "catalogo.seccion.titulo" }, async ({ contexto }) => {
    const respuesta = await cargarLaSeccion(contexto, id);
    if (!respuesta.ok) return <ErrorDelDetalle error={respuesta.error} />;
    const seccion = respuesta.dato;
    return conTitulo(
      seccion.nombre,
      <FormularioDeSeccionDeCarta
        key={`${seccion.id}-${String(seccion.version)}`}
        formulario={armarElFormularioDeSeccion(seccion, await puedeEditarProductos(contexto))}
        accion={renombrarSeccionAccion.bind(null, seccion.id, seccion.version)}
      />,
    );
  });
}
