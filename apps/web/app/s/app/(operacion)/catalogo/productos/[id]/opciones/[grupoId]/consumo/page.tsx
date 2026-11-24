import { conTitulo, pantallaDeOperacion } from "../../../../../../../../../../pantallas/operacion";
import { cargarElConsumo } from "../../../../../../../../../../servidor/consumo";
import { puedeEditarOpciones } from "../../../../../../../../../../servidor/modulos";
import { ErrorDelDetalle } from "../../../../../../../../../../ui/patrones/ErrorDelDetalle";
import { FormularioDeConsumoDeUnGrupo } from "../../../../../../../../../../ui/plantillas/catalogo/FormularioDeConsumoDeUnGrupo.cliente";
import { armarElConsumo } from "../../../../../../../../../../ui/plantillas/catalogo/modelo-de-consumo";
import { guardarConsumoAccion } from "../../../../../../../acciones-de-opciones";

type PropsDePagina = Readonly<{ params: Promise<{ id: string; grupoId: string }> }>;

// `/catalogo/productos/[id]/opciones/[grupoId]/consumo`: «Qué consume» cada opción de un grupo (maqueta `productos.html`, función `vConsumo`). Los dos ids de la dirección son lo único que viene
// del navegador: un grupo que no está en el producto (ajeno, inexistente, desactivado, la variante) sale como el genérico. La acción lleva la versión de las opciones que se vio y los ids de las
// opciones de las tarjetas: el formulario solo manda insumos, cantidades y la escala, nunca ids de opciones.
export default async function PaginaDelConsumoDeUnGrupo({ params }: PropsDePagina) {
  const { id, grupoId } = await params;
  return pantallaDeOperacion({ titulo: "catalogo.lista.titulo" }, async ({ contexto }) => {
    const respuesta = await cargarElConsumo(contexto, id, grupoId);
    if (!respuesta.ok) return <ErrorDelDetalle error={respuesta.error} />;
    const consumo = armarElConsumo(respuesta.dato);
    return conTitulo(
      respuesta.dato.nombre,
      <FormularioDeConsumoDeUnGrupo
        key={`${consumo.id}-${grupoId}-${String(respuesta.dato.versionDeOpciones)}`}
        consumo={consumo}
        accion={guardarConsumoAccion.bind(
          null,
          consumo.id,
          respuesta.dato.versionDeOpciones,
          grupoId,
          respuesta.dato.opciones.map((o) => o.id),
        )}
        puedeGuardar={await puedeEditarOpciones(contexto)}
      />,
    );
  });
}
