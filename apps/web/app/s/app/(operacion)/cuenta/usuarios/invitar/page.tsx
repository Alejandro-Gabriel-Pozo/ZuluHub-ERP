import { errorDeCodigo } from "../../../../../../../../../src/capacidades/experiencia/respuesta";
import { texto } from "../../../../../../../../../src/capacidades/vocabulario/vocabulario";
import { conTitulo, pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import {
  cargarLaFichaDeUsuario,
  cargarLasSucursalesParaInvitar,
} from "../../../../../../../servidor/usuarios";
import { ErrorDelDetalle } from "../../../../../../../ui/patrones/ErrorDelDetalle";
import { RUTAS_DE_CUENTA } from "../../../../../../../ui/plantillas/sesion/rutas-de-cuenta";
import { FormularioDeInvitacion } from "../../../../../../../ui/plantillas/usuarios/FormularioDeInvitacion.cliente";
import { armarElFormularioDeInvitacion } from "../../../../../../../ui/plantillas/usuarios/modelo-de-invitaciones";
import { invitarUsuarioAccion, reactivarUsuarioAccion } from "../../../../acciones-de-usuarios";

// `/cuenta/usuarios/invitar` (tramo U2): invitar por mail con rol y, para el Empleado, sucursales. La empresa y la persona salen de la sesión; el permiso (`usuarios.invitar`: gerente y administrador) lo decide el
// servidor al enviar, dentro de la transacción. Las sucursales que se ofrecen son las ACTIVAS de la empresa (`sucursales.ver`); sin permiso o con una falla sale el mensaje genérico, sin formulario.
// Con `?reactivar=<personaId>` (tramo U3, parte B) es el mismo formulario con el email y el rol FIJOS de esa persona desactivada: el id es lo único que viene de la dirección, el servidor busca a la persona entre las de
// LA empresa de la sesión y solo se reactiva a quien está desactivado (una activa, una ajena, una inexistente o el gerente dan el genérico, sin formulario). Al enviar, el email y el rol los vuelve a tomar el servidor.
export default async function PaginaDeInvitarUsuario({
  searchParams,
}: {
  searchParams: Promise<{ reactivar?: string | string[] }>;
}) {
  const { reactivar } = await searchParams;
  return pantallaDeOperacion({ titulo: "usuarios.lista.invitar" }, async ({ contexto }) => {
    const sucursales = await cargarLasSucursalesParaInvitar(contexto);
    if (!sucursales.ok) return <ErrorDelDetalle error={sucursales.error} />;
    const formulario = armarElFormularioDeInvitacion(sucursales.dato);
    if (reactivar === undefined) {
      return (
        <FormularioDeInvitacion
          formulario={formulario}
          accion={invitarUsuarioAccion}
          rutaDeLaLista={RUTAS_DE_CUENTA.usuarios}
        />
      );
    }
    const generico = <ErrorDelDetalle error={errorDeCodigo("USUARIOS_NO_PERMITIDO")} />;
    // Más de un `reactivar` en la dirección no es una persona: el genérico.
    if (typeof reactivar !== "string") return generico;
    const persona = await cargarLaFichaDeUsuario(contexto, reactivar);
    if (!persona.ok) return <ErrorDelDetalle error={persona.error} />;
    if (persona.dato.activo || persona.dato.rol === "GERENTE") return generico;
    return conTitulo(
      texto({}, "caja.accion.reactivar"),
      <FormularioDeInvitacion
        formulario={formulario}
        accion={reactivarUsuarioAccion.bind(null, persona.dato.personaId)}
        rutaDeLaLista={RUTAS_DE_CUENTA.usuarios}
        reactivar={{ email: persona.dato.email, rol: persona.dato.rol }}
      />,
    );
  });
}
