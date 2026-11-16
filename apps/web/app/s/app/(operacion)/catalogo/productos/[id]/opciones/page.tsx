import { conTitulo, pantallaDeOperacion } from "../../../../../../../../pantallas/operacion";
import { puedeEditarOpciones } from "../../../../../../../../servidor/modulos";
import { cargarLasOpciones } from "../../../../../../../../servidor/opciones";
import { ErrorDelDetalle } from "../../../../../../../../ui/patrones/ErrorDelDetalle";
import { armarLasOpciones } from "../../../../../../../../ui/plantillas/catalogo/modelo-de-opciones";
import { PantallaDeOpciones } from "../../../../../../../../ui/plantillas/catalogo/PantallaDeOpciones";

type PropsDePagina = Readonly<{ params: Promise<{ id: string }> }>;

// `/catalogo/productos/[id]/opciones`: los grupos de opciones de un producto (maqueta `productos.html`, solapa «Opciones», 12/11/2026). El id de la dirección es lo único que viene del
// navegador: se busca entre los productos de la empresa; uno que no está ahí (ajeno, inexistente, mal escrito, que no se vende) sale como el genérico y no dice cuál de los casos es. Los
// enlaces de escribir («Editar», «Agregar grupo», «Copiar de otro producto») solo se ofrecen si la persona puede editar las opciones. Sin entrada en el menú: se llega desde la ficha.
// El permiso (`productos.ver`) y el módulo en desarrollo los decide la consulta.
export default async function PaginaDeLasOpcionesDeUnProducto({ params }: PropsDePagina) {
  const { id } = await params;
  return pantallaDeOperacion({ titulo: "catalogo.lista.titulo" }, async ({ contexto }) => {
    const respuesta = await cargarLasOpciones(contexto, id);
    if (!respuesta.ok) return <ErrorDelDetalle error={respuesta.error} />;
    const opciones = armarLasOpciones(respuesta.dato, await puedeEditarOpciones(contexto));
    return conTitulo(opciones.titulo, <PantallaDeOpciones opciones={opciones} />);
  });
}
