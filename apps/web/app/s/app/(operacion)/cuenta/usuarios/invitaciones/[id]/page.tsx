import { conTitulo, pantallaDeOperacion } from "../../../../../../../../pantallas/operacion";
import { ofertasDeUsuarios } from "../../../../../../../../servidor/ofertas-de-administracion";
import {
  cargarLaFichaDeInvitacion,
  cargarLasSucursalesParaInvitar,
} from "../../../../../../../../servidor/usuarios";
import { ErrorDelDetalle } from "../../../../../../../../ui/patrones/ErrorDelDetalle";
import { armarLaFichaDeInvitacion } from "../../../../../../../../ui/plantillas/usuarios/modelo-de-invitaciones";
import { PantallaDeFichaDeInvitacion } from "../../../../../../../../ui/plantillas/usuarios/PantallaDeFichaDeInvitacion";
import {
  reenviarInvitacionAccion,
  revocarInvitacionAccion,
} from "../../../../../acciones-de-usuarios";

// `/cuenta/usuarios/invitaciones/[id]` (tramo U2): la ficha de una invitación pendiente, con «Reenviar» y «Revocar». El id es lo único que viene de la dirección: la empresa y quien mira salen de la
// sesión, y el servidor lo busca entre las invitaciones de ESA empresa. Un id mal escrito, de otra empresa, inexistente o ya aceptada o revocada sale igual (el genérico): no se distingue. Los botones
// solo se dibujan con su permiso; el id se liga a la acción con `.bind` (Next lo cifra), nunca va en el formulario. Los nombres de las sucursales salen de las activas de la empresa.
export default async function PaginaDeFichaDeInvitacion({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return pantallaDeOperacion({ titulo: "usuarios.lista.invitaciones" }, async ({ contexto }) => {
    const ficha = await cargarLaFichaDeInvitacion(contexto, id);
    if (!ficha.ok) return <ErrorDelDetalle error={ficha.error} />;
    const sucursales = await cargarLasSucursalesParaInvitar(contexto);
    if (!sucursales.ok) return <ErrorDelDetalle error={sucursales.error} />;
    const ofertas = await ofertasDeUsuarios(contexto);
    const armada = armarLaFichaDeInvitacion(ficha.dato, sucursales.dato);
    return conTitulo(
      armada.email,
      <PantallaDeFichaDeInvitacion
        ficha={armada}
        reenviar={
          ofertas.reenviar ? reenviarInvitacionAccion.bind(null, ficha.dato.invitacionId) : null
        }
        revocar={
          ofertas.revocar ? revocarInvitacionAccion.bind(null, ficha.dato.invitacionId) : null
        }
      />,
    );
  });
}
