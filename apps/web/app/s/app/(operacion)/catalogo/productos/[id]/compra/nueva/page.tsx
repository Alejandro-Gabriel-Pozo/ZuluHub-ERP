import { conTitulo, pantallaDeOperacion } from "../../../../../../../../../pantallas/operacion";
import { puedeEditarProductos } from "../../../../../../../../../servidor/modulos";
import { cargarLasPresentaciones } from "../../../../../../../../../servidor/presentaciones";
import { ErrorDelDetalle } from "../../../../../../../../../ui/patrones/ErrorDelDetalle";
import { FormularioDePresentacion } from "../../../../../../../../../ui/plantillas/catalogo/FormularioDePresentacion.cliente";
import { armarElFormularioDePresentacion } from "../../../../../../../../../ui/plantillas/catalogo/modelo-de-presentaciones";
import { crearPresentacionAccion } from "../../../../../../acciones-de-presentaciones";

type PropsDePagina = Readonly<{ params: Promise<{ id: string }> }>;

// `/catalogo/productos/[id]/compra/nueva`: agregar una presentación (maqueta `presentaciones.html`, «Agregar presentación»). Nada viene del navegador más que lo que se escribe y el id de la
// dirección: la empresa y la persona las pone el servidor y el permiso (`productos.editar`) lo decide el caso de uso. Agregar lo mismo otra vez devuelve la presentación ya creada, así el doble toque
// y el reintento son una sola alta. «Agregar presentación» sale apagado sin `productos.editar` (`puedeEditarProductos`, cierra ante la duda).
export default async function PaginaDeUnaPresentacionNueva({ params }: PropsDePagina) {
  const { id } = await params;
  return pantallaDeOperacion({ titulo: "catalogo.lista.titulo" }, async ({ contexto }) => {
    const respuesta = await cargarLasPresentaciones(contexto, id);
    if (!respuesta.ok) return <ErrorDelDetalle error={respuesta.error} />;
    const formulario = armarElFormularioDePresentacion(
      respuesta.dato.producto,
      null,
      await puedeEditarProductos(contexto),
    );
    return conTitulo(
      formulario.titulo,
      <FormularioDePresentacion
        formulario={formulario}
        accion={crearPresentacionAccion.bind(null, respuesta.dato.producto.id)}
      />,
    );
  });
}
