import { conTitulo, pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { puedeDesactivarUsuarios } from "../../../../../../../servidor/ofertas-de-administracion";
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
import { asignarSucursalesAccion, desactivarUsuarioAccion } from "../../../../acciones-de-usuarios";

// `/cuenta/usuarios/[personaId]`: la ficha de una persona de la empresa. El id es lo único que viene de la dirección: la empresa y quien mira salen de la sesión, y el servidor lo busca entre las personas
// de ESA empresa. Un id mal escrito, de otra empresa o inexistente sale igual (el genérico): no se distingue. Un empleado activo suma el bloque «Sucursales» (tramo U4) si quien mira puede asignarlas; la
// acción de guardar lleva la persona ligada con `.bind` (Next la cifra). Para el gerente, el administrador o un desactivado la ficha no dice nada de sucursales. «Desactivar» (tramo U3) se ofrece solo a quien
// tiene `usuarios.apagar`, y no en el gerente, no en quien está mirando ni en quien ya está desactivado; el servidor lo vuelve a imponer al enviar. Reactivar es de la parte B.
export default async function PaginaDeFichaDeUsuario({
  params,
}: {
  params: Promise<{ personaId: string }>;
}) {
  const { personaId } = await params;
  return pantallaDeOperacion({ titulo: "usuarios.lista.titulo" }, async ({ contexto }) => {
    const ficha = await cargarLaFichaDeUsuario(contexto, personaId);
    if (!ficha.ok) return <ErrorDelDetalle error={ficha.error} />;
    const armada = armarLaFichaDeUsuario(
      ficha.dato,
      {},
      {
        personaId: contexto.personaId,
        puedeDesactivar: await puedeDesactivarUsuarios(contexto),
      },
    );
    const editor = await cargarElEditorDeSucursales(contexto, personaId);
    if (!editor.ok) return <ErrorDelDetalle error={editor.error} />;
    return conTitulo(
      armada.email,
      <PantallaDeFichaDeUsuario
        ficha={armada}
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
