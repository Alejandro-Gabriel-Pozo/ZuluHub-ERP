import { conTitulo, pantallaDeOperacion } from "../../../../../../../../../pantallas/operacion";
import { puedeEditarProductos } from "../../../../../../../../../servidor/modulos";
import { cargarLaPresentacion } from "../../../../../../../../../servidor/presentaciones";
import { ErrorDelDetalle } from "../../../../../../../../../ui/patrones/ErrorDelDetalle";
import { FormularioDeEstadoDeSeccion } from "../../../../../../../../../ui/plantillas/catalogo/FormularioDeEstadoDeSeccion.cliente";
import { FormularioDePresentacion } from "../../../../../../../../../ui/plantillas/catalogo/FormularioDePresentacion.cliente";
import {
  armarElFormularioDePresentacion,
  textoDelEstado,
} from "../../../../../../../../../ui/plantillas/catalogo/modelo-de-presentaciones";
import {
  cambiarElEstadoDeLaPresentacionAccion,
  renombrarPresentacionAccion,
} from "../../../../../../acciones-de-presentaciones";

type PropsDePagina = Readonly<{ params: Promise<{ id: string; presentacionId: string }> }>;

// `/catalogo/productos/[id]/compra/[presentacionId]`: editar una presentación (maqueta `presentaciones.html`, «Editar»): su nombre y, aparte, «Desactivar» / «Reactivar». La cantidad se ve y no se
// cambia (otra cantidad es otra presentación). Los ids de la dirección son lo único que viene del navegador: una presentación que no es de un producto de la empresa sale como el genérico. Las acciones
// llevan la versión que se vio: si otra persona la cambió antes, el servidor rechaza. Los botones de escribir salen apagados sin `productos.editar` (`puedeEditarProductos`, cierra ante la duda).
export default async function PaginaDeUnaPresentacion({ params }: PropsDePagina) {
  const { id, presentacionId } = await params;
  return pantallaDeOperacion({ titulo: "catalogo.lista.titulo" }, async ({ contexto }) => {
    const respuesta = await cargarLaPresentacion(contexto, id, presentacionId);
    if (!respuesta.ok) return <ErrorDelDetalle error={respuesta.error} />;
    const { producto, presentacion } = respuesta.dato;
    const puedeEditar = await puedeEditarProductos(contexto);
    const formulario = armarElFormularioDePresentacion(producto, presentacion, puedeEditar);
    return conTitulo(
      formulario.titulo,
      <>
        <FormularioDePresentacion
          key={`${presentacion.id}-${String(presentacion.version)}`}
          formulario={formulario}
          accion={renombrarPresentacionAccion.bind(
            null,
            producto.id,
            presentacion.id,
            presentacion.version,
          )}
        />
        <FormularioDeEstadoDeSeccion
          key={`estado-${presentacion.id}-${String(presentacion.version)}`}
          texto={textoDelEstado(presentacion.activa)}
          accion={cambiarElEstadoDeLaPresentacionAccion.bind(
            null,
            producto.id,
            presentacion.id,
            presentacion.version,
            !presentacion.activa,
          )}
          apagado={!puedeEditar}
        />
      </>,
    );
  });
}
