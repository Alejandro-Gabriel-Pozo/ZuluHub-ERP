import { pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { nuevoIdDeIntento } from "../../../../../../../servidor/comandas";
import { puedeAdministrarImpresoras } from "../../../../../../../servidor/modulos";
import { FormularioDeImpresora } from "../../../../../../../ui/plantillas/salon/FormularioDeImpresora.cliente";
import { armarElFormularioDeImpresora } from "../../../../../../../ui/plantillas/salon/modelo-de-impresoras";
import { crearImpresoraAccion } from "../../../../acciones-de-impresoras";

// `/salon/impresoras/nueva`: el alta de una impresora (maqueta `imprimir.html`, «Agregar impresora», 09/11/2026). Nada viene del navegador más que lo que se escribe. La página fija UN id de impresora al abrirse y lo liga
// a la acción: el doble toque, el reintento y dos pestañas con el mismo formulario son una sola alta; recargar la página es otro intento. «Guardar» sale apagado sin `impresoras.*` (`puedeAdministrarImpresoras`).
export default async function PaginaDeLaImpresoraNueva() {
  return pantallaDeOperacion(
    { titulo: "comandas.texto.imprimir_agregar_impresora" },
    async ({ contexto }) => (
      <FormularioDeImpresora
        formulario={armarElFormularioDeImpresora(null, await puedeAdministrarImpresoras(contexto))}
        accion={crearImpresoraAccion.bind(null, nuevoIdDeIntento())}
      />
    ),
  );
}
