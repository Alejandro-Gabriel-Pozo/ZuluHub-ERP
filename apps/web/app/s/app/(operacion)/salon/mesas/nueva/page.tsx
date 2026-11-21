import { pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { puedeAdministrarMesas } from "../../../../../../../servidor/modulos";
import {
  cargarLasMesas,
  medidasDelSalon,
  nuevaClaveDeMesa,
} from "../../../../../../../servidor/salon";
import { ErrorDelDetalle } from "../../../../../../../ui/patrones/ErrorDelDetalle";
import { FormularioDeMesa } from "../../../../../../../ui/plantillas/salon/FormularioDeMesa.cliente";
import { armarElFormularioDeMesa } from "../../../../../../../ui/plantillas/salon/modelo-de-mesas";
import { crearMesaAccion } from "../../../../acciones-de-mesas";

// `/salon/mesas/nueva`: el alta de una mesa (maqueta `mesas.html`, «Agregar mesa», 09/11/2026). Nada viene del navegador más que lo que se escribe. La página fija UNA clave de creación al
// abrirse y la liga a la acción: el doble toque y el reintento son una sola alta; recargar la página es otro intento. «Guardar» sale apagado sin `mesas.*` (`puedeAdministrarMesas`).
// Las mesas de la sucursal se leen para dibujar el mapa chico (S-1b); si no se pueden leer sale el error, no un plano a medias.
export default async function PaginaDeLaMesaNueva() {
  return pantallaDeOperacion({ titulo: "salon.texto.admin_agregar_mesa" }, async ({ contexto }) => {
    const mesas = await cargarLasMesas(contexto);
    if (!mesas.ok) return <ErrorDelDetalle error={mesas.error} />;
    return (
      <FormularioDeMesa
        formulario={armarElFormularioDeMesa(null, await puedeAdministrarMesas(contexto), {
          medidas: medidasDelSalon(),
          mesas: mesas.dato.mesas,
        })}
        accion={crearMesaAccion.bind(null, nuevaClaveDeMesa())}
      />
    );
  });
}
