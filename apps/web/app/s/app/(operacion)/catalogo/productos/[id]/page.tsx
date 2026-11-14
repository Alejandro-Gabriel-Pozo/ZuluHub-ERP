import { conTitulo, pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { cargarLaFicha } from "../../../../../../../servidor/ficha-de-producto";
import { puedeEditarProductos } from "../../../../../../../servidor/modulos";
import { FormularioDeFichaDeProducto } from "../../../../../../../ui/plantillas/catalogo/FormularioDeFichaDeProducto.cliente";
import { armarLaFicha } from "../../../../../../../ui/plantillas/catalogo/modelo-de-ficha-de-producto";
import { ErrorDelDetalle } from "../../../../../../../ui/patrones/ErrorDelDetalle";
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
    return conTitulo(
      ficha.titulo,
      <FormularioDeFichaDeProducto
        key={`${ficha.id}-${String(ficha.version)}`}
        ficha={ficha}
        accion={guardarFichaAccion.bind(null, ficha.id, ficha.version)}
        puedeGuardar={await puedeEditarProductos(contexto)}
      />,
    );
  });
}
