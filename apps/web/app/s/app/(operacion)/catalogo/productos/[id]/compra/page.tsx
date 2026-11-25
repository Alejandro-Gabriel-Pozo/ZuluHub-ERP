import { conTitulo, pantallaDeOperacion } from "../../../../../../../../pantallas/operacion";
import { puedeEditarProductos } from "../../../../../../../../servidor/modulos";
import { cargarLasPresentaciones } from "../../../../../../../../servidor/presentaciones";
import { ErrorDelDetalle } from "../../../../../../../../ui/patrones/ErrorDelDetalle";
import { PantallaDePresentaciones } from "../../../../../../../../ui/plantillas/catalogo/PantallaDePresentaciones";
import { armarLaListaDePresentaciones } from "../../../../../../../../ui/plantillas/catalogo/modelo-de-presentaciones";

type PropsDePagina = Readonly<{ params: Promise<{ id: string }> }>;

// `/catalogo/productos/[id]/compra`: las presentaciones de compra de un producto (maqueta `presentaciones.html` y solapa «Cómo se compra» de `productos.html`, T0). El id de la dirección es lo único
// que viene del navegador: se busca entre los productos de la empresa; uno que no está ahí (ajeno, inexistente, mal escrito, que no se compra) sale como el genérico y no dice cuál de los casos
// es. Los botones de escribir («Agregar presentación», «Editar») se dibujan siempre y van apagados si la persona no puede editar. Sin entrada en el menú: se llega desde la ficha. El permiso
// (`productos.ver`) lo decide la consulta.
export default async function PaginaDeLasPresentacionesDeUnProducto({ params }: PropsDePagina) {
  const { id } = await params;
  return pantallaDeOperacion({ titulo: "catalogo.lista.titulo" }, async ({ contexto }) => {
    const respuesta = await cargarLasPresentaciones(contexto, id);
    if (!respuesta.ok) return <ErrorDelDetalle error={respuesta.error} />;
    const lista = armarLaListaDePresentaciones(
      respuesta.dato,
      await puedeEditarProductos(contexto),
    );
    return conTitulo(lista.titulo, <PantallaDePresentaciones lista={lista} />);
  });
}
