import { pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { cargarLasSucursalesParaInvitar } from "../../../../../../../servidor/usuarios";
import { ErrorDelDetalle } from "../../../../../../../ui/patrones/ErrorDelDetalle";
import { RUTAS_DE_CUENTA } from "../../../../../../../ui/plantillas/sesion/rutas-de-cuenta";
import { FormularioDeInvitacion } from "../../../../../../../ui/plantillas/usuarios/FormularioDeInvitacion.cliente";
import { armarElFormularioDeInvitacion } from "../../../../../../../ui/plantillas/usuarios/modelo-de-invitaciones";
import { invitarUsuarioAccion } from "../../../../acciones-de-usuarios";

// `/cuenta/usuarios/invitar` (tramo U2): invitar por mail con rol y, para el Empleado, sucursales. La empresa y la persona salen de la sesión; el permiso (`usuarios.invitar`: gerente y administrador) lo decide el
// servidor al enviar, dentro de la transacción. Las sucursales que se ofrecen son las ACTIVAS de la empresa (`sucursales.ver`); sin permiso o con una falla sale el mensaje genérico, sin formulario.
export default async function PaginaDeInvitarUsuario() {
  return pantallaDeOperacion({ titulo: "usuarios.lista.invitar" }, async ({ contexto }) => {
    const sucursales = await cargarLasSucursalesParaInvitar(contexto);
    if (!sucursales.ok) return <ErrorDelDetalle error={sucursales.error} />;
    return (
      <FormularioDeInvitacion
        formulario={armarElFormularioDeInvitacion(sucursales.dato)}
        accion={invitarUsuarioAccion}
        rutaDeLaLista={RUTAS_DE_CUENTA.usuarios}
      />
    );
  });
}
