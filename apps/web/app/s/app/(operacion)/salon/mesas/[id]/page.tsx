import { pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { puedeAdministrarMesas } from "../../../../../../../servidor/modulos";
import { cargarLaMesa } from "../../../../../../../servidor/salon";
import { ErrorDelDetalle } from "../../../../../../../ui/patrones/ErrorDelDetalle";
import { FormularioDeMesa } from "../../../../../../../ui/plantillas/salon/FormularioDeMesa.cliente";
import { armarElFormularioDeMesa } from "../../../../../../../ui/plantillas/salon/modelo-de-mesas";
import { editarMesaAccion } from "../../../../acciones-de-mesas";

type PropsDePagina = Readonly<{ params: Promise<{ id: string }> }>;

// `/salon/mesas/[id]`: editar una mesa (maqueta `mesas.html`, «Editar mesa»). El id de la dirección es lo único que viene del navegador: se busca entre las mesas de la sucursal con la que se
// trabaja; una que no está ahí (ajena, inexistente, mal escrita) sale como el genérico y no dice cuál de los casos es. La versión que se vio viaja ligada a la acción: si otra persona cambió
// la mesa antes, el servidor rechaza sin escribir.
export default async function PaginaDeLaMesa({ params }: PropsDePagina) {
  const { id } = await params;
  return pantallaDeOperacion({ titulo: "salon.texto.admin_editar_mesa" }, async ({ contexto }) => {
    const respuesta = await cargarLaMesa(contexto, id);
    if (!respuesta.ok) return <ErrorDelDetalle error={respuesta.error} />;
    return (
      <FormularioDeMesa
        formulario={armarElFormularioDeMesa(respuesta.dato, await puedeAdministrarMesas(contexto))}
        accion={editarMesaAccion.bind(null, respuesta.dato.id, respuesta.dato.version)}
      />
    );
  });
}
