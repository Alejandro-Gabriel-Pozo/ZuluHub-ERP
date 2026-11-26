import { randomUUID } from "node:crypto";
import { texto } from "../../../../../../../../../src/capacidades/vocabulario/vocabulario";
import { conTitulo, pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { cargarLosRoles } from "../../../../../../../servidor/roles";
import { ErrorDelDetalle } from "../../../../../../../ui/patrones/ErrorDelDetalle";
import { armarElFormularioDeAlta } from "../../../../../../../ui/plantillas/roles/modelo-de-roles";
import { FormularioDeAltaDeRol } from "../../../../../../../ui/plantillas/roles/FormularioDeAltaDeRol.cliente";
import { RUTAS_DE_CUENTA } from "../../../../../../../ui/plantillas/sesion/rutas-de-cuenta";
import { crearRolAccion } from "../../../../acciones-de-roles";

// `/cuenta/roles/nuevo`: el formulario de alta. El id del rol lo genera el servidor al abrir la página y se liga a la acción con `.bind` (Next lo cifra): es la clave de idempotencia, así un doble toque o un reintento de
// red devuelven el mismo rol y nunca dos. Los roles activos se ofrecen para copiar; qué puede crear la persona lo decide el servidor al enviar (solo el gerente).
export default async function PaginaDeNuevoRol() {
  return pantallaDeOperacion({ titulo: "roles.lista.titulo" }, async ({ contexto }) => {
    const roles = await cargarLosRoles(contexto);
    if (!roles.ok) return <ErrorDelDetalle error={roles.error} />;
    const copiables = roles.dato.filter((r) => r.activo);
    return conTitulo(
      texto({}, "roles.lista.nuevo"),
      <FormularioDeAltaDeRol
        formulario={armarElFormularioDeAlta(copiables, {})}
        accion={crearRolAccion.bind(null, randomUUID())}
        rutaDeLaLista={RUTAS_DE_CUENTA.roles}
      />,
    );
  });
}
