import { conTitulo, pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import {
  cargarLaFichaDeRol,
  cargarLasAccionesParaElegir,
  ofertasDeRoles,
} from "../../../../../../../servidor/roles";
import { ErrorDelDetalle } from "../../../../../../../ui/patrones/ErrorDelDetalle";
import { AccionDeEstadoDeRol } from "../../../../../../../ui/plantillas/roles/AccionDeEstadoDeRol.cliente";
import { FormularioDeFichaDeRol } from "../../../../../../../ui/plantillas/roles/FormularioDeFichaDeRol.cliente";
import { armarLaFichaDeRol } from "../../../../../../../ui/plantillas/roles/modelo-de-roles";
import { RUTAS_DE_CUENTA } from "../../../../../../../ui/plantillas/sesion/rutas-de-cuenta";
import {
  archivarRolAccion,
  guardarRolAccion,
  reactivarRolAccion,
} from "../../../../acciones-de-roles";

// `/cuenta/roles/[rolId]`: la ficha de un rol propio. El id es lo único que viene de la dirección: la empresa y quien mira salen de la sesión, y el servidor lo busca entre los roles de ESA empresa. Un id mal escrito, de
// otra empresa o inexistente sale igual (el genérico). Guardar lleva el rol y la versión que se vio ligados con `.bind` (Next los cifra): si otra persona lo cambió antes, el servidor rechaza y la ficha vuelve a leer.
// «Archivar» y «Reactivar» se ofrecen solo a quien puede editar; el servidor lo vuelve a exigir.
export default async function PaginaDeFichaDeRol({
  params,
}: {
  params: Promise<{ rolId: string }>;
}) {
  const { rolId } = await params;
  return pantallaDeOperacion({ titulo: "roles.lista.titulo" }, async ({ contexto }) => {
    const rol = await cargarLaFichaDeRol(contexto, rolId);
    if (!rol.ok) return <ErrorDelDetalle error={rol.error} />;
    const modulos = await cargarLasAccionesParaElegir(contexto);
    if (!modulos.ok) return <ErrorDelDetalle error={modulos.error} />;
    const ofertas = await ofertasDeRoles(contexto);
    const ficha = armarLaFichaDeRol(rol.dato, modulos.dato, {}, { editar: ofertas.editar });
    return conTitulo(
      rol.dato.nombre,
      <>
        <FormularioDeFichaDeRol
          ficha={ficha}
          accion={guardarRolAccion.bind(null, rol.dato.rolId, rol.dato.version)}
          rutaDeLaLista={RUTAS_DE_CUENTA.roles}
        />
        {ficha.archivar === null ? null : (
          <AccionDeEstadoDeRol
            accion={archivarRolAccion.bind(null, rol.dato.rolId)}
            texto={ficha.archivar}
          />
        )}
        {ficha.reactivar === null ? null : (
          <AccionDeEstadoDeRol
            accion={reactivarRolAccion.bind(null, rol.dato.rolId)}
            texto={ficha.reactivar}
          />
        )}
      </>,
    );
  });
}
