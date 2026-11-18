import { pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { puedeAdministrarImpresoras } from "../../../../../../../servidor/modulos";
import { cargarLaImpresora } from "../../../../../../../servidor/impresoras";
import { ErrorDelDetalle } from "../../../../../../../ui/patrones/ErrorDelDetalle";
import { FormularioDeImpresora } from "../../../../../../../ui/plantillas/salon/FormularioDeImpresora.cliente";
import { armarElFormularioDeImpresora } from "../../../../../../../ui/plantillas/salon/modelo-de-impresoras";
import { editarImpresoraAccion } from "../../../../acciones-de-impresoras";

type PropsDePagina = Readonly<{ params: Promise<{ id: string }> }>;

// `/salon/impresoras/[id]`: editar una impresora (se abre desde su nombre en la lista). El id de la dirección es lo único que viene del navegador: se busca entre las impresoras activas de la sucursal con la que se trabaja;
// una que no está ahí (ajena, inexistente, desactivada, mal escrita) sale como el genérico y no dice cuál de los casos es. La versión que se vio viaja ligada a la acción: si otra persona cambió la impresora antes, el
// servidor rechaza sin escribir.
export default async function PaginaDeLaImpresora({ params }: PropsDePagina) {
  const { id } = await params;
  return pantallaDeOperacion(
    { titulo: "comandas.texto.imprimir_impresoras" },
    async ({ contexto }) => {
      const respuesta = await cargarLaImpresora(contexto, id);
      if (!respuesta.ok) return <ErrorDelDetalle error={respuesta.error} />;
      return (
        <FormularioDeImpresora
          formulario={armarElFormularioDeImpresora(
            respuesta.dato,
            await puedeAdministrarImpresoras(contexto),
          )}
          accion={editarImpresoraAccion.bind(null, respuesta.dato.id, respuesta.dato.version)}
        />
      );
    },
  );
}
