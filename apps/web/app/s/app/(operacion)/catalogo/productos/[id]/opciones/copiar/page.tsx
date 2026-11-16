import { conTitulo, pantallaDeOperacion } from "../../../../../../../../../pantallas/operacion";
import { puedeEditarOpciones } from "../../../../../../../../../servidor/modulos";
import { cargarLaCopia } from "../../../../../../../../../servidor/opciones";
import { ErrorDelDetalle } from "../../../../../../../../../ui/patrones/ErrorDelDetalle";
import { FormularioDeCopiaDeOpciones } from "../../../../../../../../../ui/plantillas/catalogo/FormularioDeCopiaDeOpciones.cliente";
import { armarLaCopia } from "../../../../../../../../../ui/plantillas/catalogo/modelo-de-opciones";
import { copiarOpcionesAccion } from "../../../../../../acciones-de-opciones";

type PropsDePagina = Readonly<{ params: Promise<{ id: string }> }>;

// `/catalogo/productos/[id]/opciones/copiar`: «Copiar de otro producto» (maqueta `productos.html`). El id de la dirección es lo único que viene del navegador. La clave de la copia la fija
// la página al armarse (copiar dos veces con la misma no copia dos veces) y la acción lleva la versión de las opciones que se vio; el producto de origen es lo único que elige la persona.
export default async function PaginaDeLaCopiaDeOpciones({ params }: PropsDePagina) {
  const { id } = await params;
  return pantallaDeOperacion({ titulo: "catalogo.lista.titulo" }, async ({ contexto }) => {
    const respuesta = await cargarLaCopia(contexto, id);
    if (!respuesta.ok) return <ErrorDelDetalle error={respuesta.error} />;
    const copia = armarLaCopia(respuesta.dato);
    return conTitulo(
      respuesta.dato.nombre,
      <FormularioDeCopiaDeOpciones
        key={`${copia.id}-${String(respuesta.dato.versionDeOpciones)}`}
        copia={copia}
        accion={copiarOpcionesAccion.bind(
          null,
          copia.id,
          respuesta.dato.versionDeOpciones,
          respuesta.dato.claveDeLaCopia,
        )}
        puedeGuardar={await puedeEditarOpciones(contexto)}
      />,
    );
  });
}
