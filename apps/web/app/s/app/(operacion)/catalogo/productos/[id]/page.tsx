import { conTitulo, pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { cargarLaClasificacionDelProducto } from "../../../../../../../servidor/clasificacion";
import { cargarLaFicha } from "../../../../../../../servidor/ficha-de-producto";
import { puedeEditarProductos } from "../../../../../../../servidor/modulos";
import { ClasificacionDelProducto } from "../../../../../../../ui/plantillas/catalogo/ClasificacionDelProducto.cliente";
import { FormularioDeFichaDeProducto } from "../../../../../../../ui/plantillas/catalogo/FormularioDeFichaDeProducto.cliente";
import { armarLaClasificacionDelProducto } from "../../../../../../../ui/plantillas/catalogo/modelo-de-clasificacion";
import { armarLaFicha } from "../../../../../../../ui/plantillas/catalogo/modelo-de-ficha-de-producto";
import { ErrorDelDetalle } from "../../../../../../../ui/patrones/ErrorDelDetalle";
import { Pila } from "../../../../../../../ui/primitivas/Pila";
import { clasificarProductoAccion } from "../../../../acciones-de-clasificacion";
import { guardarFichaAccion } from "../../../../acciones-de-productos";

type PropsDePagina = Readonly<{ params: Promise<{ id: string }> }>;

// `/catalogo/productos/[id]`: los datos de un producto (maqueta `productos.html`, solapa «Datos», 12/11/2026). El id de la dirección es lo único que viene del navegador: se busca entre
// los productos de la empresa; uno que no está ahí (ajeno, inexistente, mal escrito) sale como el genérico y no dice cuál de los casos es. La acción lleva la versión que se vio; si
// otra persona guardó antes, el servidor rechaza. Sin entrada en el menú: se llega por la dirección. El permiso (`productos.ver`) y el módulo en desarrollo los decide la consulta.
export default async function PaginaDeLaFichaDeUnProducto({ params }: PropsDePagina) {
  const { id } = await params;
  return pantallaDeOperacion({ titulo: "catalogo.lista.titulo" }, async ({ contexto }) => {
    const respuesta = await cargarLaFicha(contexto, id);
    if (!respuesta.ok) return <ErrorDelDetalle error={respuesta.error} />;
    const ficha = armarLaFicha(respuesta.dato);
    const puedeEditar = await puedeEditarProductos(contexto);
    // La clasificación comercial (A14) reemplaza al campo suelto «Categoría» (dueño, 12/11/2026): una sección propia debajo de los datos, con su hoja «Cambiar».
    const clasificacion = await cargarLaClasificacionDelProducto(contexto, ficha.id);
    return conTitulo(
      ficha.titulo,
      <Pila separacion={4}>
        <FormularioDeFichaDeProducto
          key={`${ficha.id}-${String(ficha.version)}`}
          ficha={ficha}
          accion={guardarFichaAccion.bind(null, ficha.id, ficha.version)}
          puedeGuardar={puedeEditar}
        />
        {clasificacion.ok ? (
          <ClasificacionDelProducto
            clasificacion={armarLaClasificacionDelProducto(clasificacion.dato)}
            accion={clasificarProductoAccion}
            puedeCambiar={puedeEditar}
          />
        ) : (
          <ErrorDelDetalle error={clasificacion.error} />
        )}
      </Pila>,
    );
  });
}
