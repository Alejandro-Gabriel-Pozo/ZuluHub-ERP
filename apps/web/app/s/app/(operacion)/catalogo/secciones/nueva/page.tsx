import { pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { puedeEditarProductos } from "../../../../../../../servidor/modulos";
import { nuevaClaveDeSeccion } from "../../../../../../../servidor/secciones";
import { FormularioDeSeccionDeCarta } from "../../../../../../../ui/plantillas/catalogo/FormularioDeSeccionDeCarta.cliente";
import { armarElFormularioDeSeccion } from "../../../../../../../ui/plantillas/catalogo/modelo-de-secciones";
import { crearSeccionAccion } from "../../../../acciones-de-secciones";

// `/catalogo/secciones/nueva`: el alta de una sección (maqueta `productos-secciones.html`, «Nueva sección», 12/11/2026). Nada viene del navegador más que lo que se escribe: la empresa y la
// persona las pone el servidor y el permiso (`productos.editar`) y el módulo en desarrollo los decide el caso de uso. La página fija UNA clave de creación al abrirse y la liga a la acción: el
// doble toque y el reintento son una sola alta; recargar la página es otro intento. «Guardar» sale apagado sin `productos.editar` (`puedeEditarProductos`, cierra ante la duda).
export default async function PaginaDeLaSeccionNueva() {
  return pantallaDeOperacion({ titulo: "catalogo.seccion.nueva" }, async ({ contexto }) => (
    <FormularioDeSeccionDeCarta
      formulario={armarElFormularioDeSeccion(null, await puedeEditarProductos(contexto))}
      accion={crearSeccionAccion.bind(null, nuevaClaveDeSeccion())}
    />
  ));
}
