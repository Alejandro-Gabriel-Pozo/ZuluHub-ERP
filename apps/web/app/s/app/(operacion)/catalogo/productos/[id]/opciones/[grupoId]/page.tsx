import { conTitulo, pantallaDeOperacion } from "../../../../../../../../../pantallas/operacion";
import { puedeEditarOpciones } from "../../../../../../../../../servidor/modulos";
import { cargarUnGrupo } from "../../../../../../../../../servidor/opciones";
import { ErrorDelDetalle } from "../../../../../../../../../ui/patrones/ErrorDelDetalle";
import { FormularioDeGrupoDeOpciones } from "../../../../../../../../../ui/plantillas/catalogo/FormularioDeGrupoDeOpciones.cliente";
import { armarElGrupo } from "../../../../../../../../../ui/plantillas/catalogo/modelo-de-opciones";
import { guardarGrupoAccion } from "../../../../../../acciones-de-opciones";

type PropsDePagina = Readonly<{ params: Promise<{ id: string; grupoId: string }> }>;

// `/catalogo/productos/[id]/opciones/[grupoId]`: editar un grupo (maqueta `productos.html`, «Editar»). Los dos ids de la dirección son lo único que viene del navegador: un grupo que no
// está en el producto (ajeno, inexistente, desactivado, la variante) sale como el genérico. La acción lleva la versión de las opciones que se vio y los ids de las opciones de la lista:
// el formulario solo manda los nombres y los recargos, nunca los ids.
export default async function PaginaDeUnGrupoDeOpciones({ params }: PropsDePagina) {
  const { id, grupoId } = await params;
  return pantallaDeOperacion({ titulo: "catalogo.lista.titulo" }, async ({ contexto }) => {
    const respuesta = await cargarUnGrupo(contexto, id, grupoId);
    if (!respuesta.ok) return <ErrorDelDetalle error={respuesta.error} />;
    const grupo = armarElGrupo(respuesta.dato);
    return conTitulo(
      respuesta.dato.nombre,
      <FormularioDeGrupoDeOpciones
        key={`${grupo.id}-${String(respuesta.dato.versionDeOpciones)}-${grupoId}`}
        grupo={grupo}
        accion={guardarGrupoAccion.bind(
          null,
          grupo.id,
          respuesta.dato.versionDeOpciones,
          grupoId,
          respuesta.dato.claveDelCambio,
          respuesta.dato.grupo === null ? [] : respuesta.dato.grupo.opciones.map((o) => o.id),
        )}
        puedeGuardar={await puedeEditarOpciones(contexto)}
      />,
    );
  });
}
