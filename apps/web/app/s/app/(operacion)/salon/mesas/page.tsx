import { pantallaDeOperacion } from "../../../../../../pantallas/operacion";
import { puedeAdministrarMesas } from "../../../../../../servidor/modulos";
import { cargarLasMesas } from "../../../../../../servidor/salon";
import { armarLaListaDeMesas } from "../../../../../../ui/plantillas/salon/modelo-de-mesas";
import { PantallaDeListaDeMesas } from "../../../../../../ui/plantillas/salon/PantallaDeListaDeMesas";
import { ErrorDelDetalle } from "../../../../../../ui/patrones/ErrorDelDetalle";
import { desactivarMesaAccion, reactivarMesaAccion } from "../../../acciones-de-mesas";

// `/salon/mesas`: todas las mesas de la sucursal con la que se trabaja, también las desactivadas (maqueta `mesas.html`, aprobada el 09/11/2026). La empresa, la persona y la sucursal las pone
// el servidor y el permiso (`mesas.ver`), la perilla `salon` y el módulo en desarrollo los decide la consulta; «Agregar mesa», «Editar mesa», «Desactivar» y «Reactivar» se ofrecen solo
// con `mesas.*` (`puedeAdministrarMesas`, cierra ante la duda).
export default async function PaginaDeLaListaDeMesas() {
  return pantallaDeOperacion({ titulo: "salon.texto.admin_mesas" }, async ({ contexto }) => {
    const respuesta = await cargarLasMesas(contexto);
    const lista = respuesta.ok
      ? armarLaListaDeMesas(respuesta.dato.mesas, await puedeAdministrarMesas(contexto))
      : null;
    return (
      <PantallaDeListaDeMesas
        lista={lista}
        accionDeEstado={(mesaId, reactivar) =>
          (reactivar ? reactivarMesaAccion : desactivarMesaAccion).bind(null, mesaId)
        }
        error={respuesta.ok ? null : <ErrorDelDetalle error={respuesta.error} />}
      />
    );
  });
}
