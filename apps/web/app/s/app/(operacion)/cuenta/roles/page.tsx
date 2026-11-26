import { pantallaDeOperacion } from "../../../../../../pantallas/operacion";
import { cargarLosRoles, ofertasDeRoles } from "../../../../../../servidor/roles";
import { ErrorDelDetalle } from "../../../../../../ui/patrones/ErrorDelDetalle";
import { armarLaListaDeRoles } from "../../../../../../ui/plantillas/roles/modelo-de-roles";
import { PantallaDeListaDeRoles } from "../../../../../../ui/plantillas/roles/PantallaDeListaDeRoles";

// `/cuenta/roles`: los roles propios de la empresa. Abrirlo solo lee. La empresa y la persona salen de la sesión; el permiso (`roles.ver`: solo el gerente) lo decide el servidor dentro de la consulta. Sin permiso o con
// una falla sale el mensaje genérico del catálogo, sin filas ni botones. «Nuevo rol» se ofrece solo a quien puede crear; el servidor lo vuelve a exigir.
export default async function PaginaDeRoles() {
  return pantallaDeOperacion({ titulo: "roles.lista.titulo" }, async ({ contexto }) => {
    const roles = await cargarLosRoles(contexto);
    if (!roles.ok) return <ErrorDelDetalle error={roles.error} />;
    const ofertas = await ofertasDeRoles(contexto);
    return <PantallaDeListaDeRoles lista={armarLaListaDeRoles(roles.dato, {}, ofertas.crear)} />;
  });
}
