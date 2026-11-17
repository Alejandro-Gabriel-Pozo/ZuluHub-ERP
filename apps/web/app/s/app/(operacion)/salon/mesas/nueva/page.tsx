import { pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { puedeAdministrarMesas } from "../../../../../../../servidor/modulos";
import { nuevaClaveDeMesa } from "../../../../../../../servidor/salon";
import { FormularioDeMesa } from "../../../../../../../ui/plantillas/salon/FormularioDeMesa.cliente";
import { armarElFormularioDeMesa } from "../../../../../../../ui/plantillas/salon/modelo-de-mesas";
import { crearMesaAccion } from "../../../../acciones-de-mesas";

// `/salon/mesas/nueva`: el alta de una mesa (maqueta `mesas.html`, «Agregar mesa», 09/11/2026). Nada viene del navegador más que lo que se escribe. La página fija UNA clave de creación al
// abrirse y la liga a la acción: el doble toque y el reintento son una sola alta; recargar la página es otro intento. «Guardar» sale apagado sin `mesas.*` (`puedeAdministrarMesas`).
export default async function PaginaDeLaMesaNueva() {
  return pantallaDeOperacion({ titulo: "salon.texto.admin_agregar_mesa" }, async ({ contexto }) => (
    <FormularioDeMesa
      formulario={armarElFormularioDeMesa(null, await puedeAdministrarMesas(contexto))}
      accion={crearMesaAccion.bind(null, nuevaClaveDeMesa())}
    />
  ));
}
