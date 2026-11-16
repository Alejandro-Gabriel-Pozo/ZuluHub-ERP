import { conTitulo, pantallaDeOperacion } from "../../../../../../../../../pantallas/operacion";
import { puedeEditarOpciones } from "../../../../../../../../../servidor/modulos";
import { cargarUnGrupo } from "../../../../../../../../../servidor/opciones";
import { ErrorDelDetalle } from "../../../../../../../../../ui/patrones/ErrorDelDetalle";
import { FormularioDeGrupoDeOpciones } from "../../../../../../../../../ui/plantillas/catalogo/FormularioDeGrupoDeOpciones.cliente";
import { armarElGrupo } from "../../../../../../../../../ui/plantillas/catalogo/modelo-de-opciones";
import { guardarGrupoAccion } from "../../../../../../acciones-de-opciones";

type PropsDePagina = Readonly<{ params: Promise<{ id: string }> }>;

// `/catalogo/productos/[id]/opciones/nuevo`: un grupo nuevo (maqueta `productos.html`, «Agregar grupo»). La clave del cambio (que es el id del grupo y de la que salen los de sus opciones) la
// fija la página al armarse: el doble toque y el reintento mandan la misma. La acción lleva la versión de las opciones que se vio; si otra persona cambió antes, el servidor rechaza.
export default async function PaginaDeUnGrupoNuevoDeOpciones({ params }: PropsDePagina) {
  const { id } = await params;
  return pantallaDeOperacion({ titulo: "catalogo.lista.titulo" }, async ({ contexto }) => {
    const respuesta = await cargarUnGrupo(contexto, id, null);
    if (!respuesta.ok) return <ErrorDelDetalle error={respuesta.error} />;
    const grupo = armarElGrupo(respuesta.dato);
    return conTitulo(
      respuesta.dato.nombre,
      <FormularioDeGrupoDeOpciones
        key={`${grupo.id}-${String(respuesta.dato.versionDeOpciones)}`}
        grupo={grupo}
        accion={guardarGrupoAccion.bind(
          null,
          grupo.id,
          respuesta.dato.versionDeOpciones,
          null,
          respuesta.dato.claveDelCambio,
          [],
        )}
        puedeGuardar={await puedeEditarOpciones(contexto)}
      />,
    );
  });
}
