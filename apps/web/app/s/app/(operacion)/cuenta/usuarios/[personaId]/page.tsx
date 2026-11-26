import { conTitulo, pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { ofertasDeUsuarios } from "../../../../../../../servidor/ofertas-de-administracion";
import {
  cargarElEditorDeSucursales,
  cargarLaFichaDeUsuario,
} from "../../../../../../../servidor/usuarios";
import { ErrorDelDetalle } from "../../../../../../../ui/patrones/ErrorDelDetalle";
import {
  armarElEditorDeSucursales,
  armarLaFichaDeUsuario,
} from "../../../../../../../ui/plantillas/usuarios/modelo-de-usuarios";
import { PantallaDeFichaDeUsuario } from "../../../../../../../ui/plantillas/usuarios/PantallaDeFichaDeUsuario";
import { cargarLosRolesAsignables, ofertasDeRoles } from "../../../../../../../servidor/roles";
import { armarElEditorDeRolDeUsuario } from "../../../../../../../ui/plantillas/roles/modelo-de-roles";
import { asignarRolAccion } from "../../../../acciones-de-roles";
import { asignarSucursalesAccion, desactivarUsuarioAccion } from "../../../../acciones-de-usuarios";

// `/cuenta/usuarios/[personaId]`: la ficha de una persona de la empresa. El id es lo único que viene de la dirección: la empresa y quien mira salen de la sesión, y el servidor lo busca entre las personas
// de ESA empresa. Un id mal escrito, de otra empresa o inexistente sale igual (el genérico): no se distingue. Un empleado activo suma el bloque «Sucursales» (tramo U4) si quien mira puede asignarlas; la
// acción de guardar lleva la persona ligada con `.bind` (Next la cifra). Para el gerente, el administrador o un desactivado la ficha no dice nada de sucursales. «Desactivar» (tramo U3) se ofrece solo a quien
// tiene `usuarios.apagar`, y no en el gerente, no en quien está mirando ni en quien ya está desactivado; el servidor lo vuelve a imponer al enviar. «Reactivar» (parte B) solo en una persona desactivada y a quien puede invitar (`usuarios.invitar`): es una invitación nueva con el mismo rol.
export default async function PaginaDeFichaDeUsuario({
  params,
}: {
  params: Promise<{ personaId: string }>;
}) {
  const { personaId } = await params;
  return pantallaDeOperacion({ titulo: "usuarios.lista.titulo" }, async ({ contexto }) => {
    const ficha = await cargarLaFichaDeUsuario(contexto, personaId);
    if (!ficha.ok) return <ErrorDelDetalle error={ficha.error} />;
    const ofertas = await ofertasDeUsuarios(contexto);
    const armada = armarLaFichaDeUsuario(
      ficha.dato,
      {},
      {
        personaId: contexto.personaId,
        puedeDesactivar: ofertas.desactivar,
        puedeReactivar: ofertas.invitar,
      },
    );
    const editor = await cargarElEditorDeSucursales(contexto, personaId);
    if (!editor.ok) return <ErrorDelDetalle error={editor.error} />;
    // «Rol» (solo el gerente, y no sobre el gerente): el selector con los roles asignables. Sin permiso o con una falla, la ficha no ofrece cambiar el rol (el servidor lo vuelve a exigir al enviar).
    const ofertasDeRol = await ofertasDeRoles(contexto);
    const asignables = ofertasDeRol.asignar ? await cargarLosRolesAsignables(contexto) : null;
    const actual =
      typeof ficha.dato.rol === "string"
        ? ({ tipo: "BASE", rol: ficha.dato.rol } as const)
        : ficha.dato.rolPropioId === null
          ? null
          : ({
              tipo: "PROPIO",
              rolId: ficha.dato.rolPropioId,
              nombre: ficha.dato.rol.propio,
            } as const);
    const editorDeRol =
      asignables?.ok === true && actual !== null
        ? armarElEditorDeRolDeUsuario(asignables.dato, actual, {})
        : null;
    const rol =
      editorDeRol === null
        ? null
        : { editor: editorDeRol, accion: asignarRolAccion.bind(null, personaId) };
    return conTitulo(
      armada.email,
      <PantallaDeFichaDeUsuario
        ficha={armada}
        rol={rol}
        desactivar={desactivarUsuarioAccion.bind(null, ficha.dato.personaId)}
        sucursales={
          editor.dato === null
            ? null
            : {
                editor: armarElEditorDeSucursales(editor.dato),
                accion: asignarSucursalesAccion.bind(null, personaId),
              }
        }
      />,
    );
  });
}
