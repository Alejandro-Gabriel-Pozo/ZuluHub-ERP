import { Insignia } from "../../componentes/Insignia";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import {
  ConfirmacionDeDesactivar,
  type PropsDeConfirmacionDeDesactivar,
} from "./ConfirmacionDeDesactivar.cliente";
import { FormularioDeSucursalesDeUsuario } from "./FormularioDeSucursalesDeUsuario.cliente";
import type { EditorDeSucursalesArmado, FichaDeUsuarioArmada } from "./modelo-de-usuarios";
import estilos from "./PantallaDeUsuarios.module.css";

export type PropsDePantallaDeFichaDeUsuario = Readonly<{
  ficha: FichaDeUsuarioArmada;
  /** La acción de desactivar con el id ya ligado; solo se usa si la ficha ofrece «Desactivar». */
  desactivar?: PropsDeConfirmacionDeDesactivar["accion"];
  /**
   * El bloque «Sucursales» de un empleado activo, con la acción de guardar ya ligada a su persona. `null` (o sin él): la ficha no dice nada de sucursales (gerente, administrador, desactivado
   * o quien mira no puede asignarlas).
   */
  sucursales?: Readonly<{ editor: EditorDeSucursalesArmado; accion: AccionDeFormulario }> | null;
}>;

/**
 * La ficha de una persona (maqueta `usuarios.html`, `vUsuario`): el email es el título de la pantalla (lo pone la página) y debajo van el rol y el estado. Un empleado activo suma el bloque «Sucursales»
 * con «Guardar» (tramo U4). Al pie, «Desactivar» (con su confirmación, tramo U3) solo si el modelo la ofrece (activa, no es el gerente, no es quien mira y quien mira tiene el permiso); «Reactivar» lo suma
 * la parte B. El estado se dice con texto en su insignia. Es una página de servidor: lo interactivo está en `ConfirmacionDeDesactivar.cliente.tsx` y `FormularioDeSucursalesDeUsuario.cliente.tsx`.
 */
export function PantallaDeFichaDeUsuario({
  ficha,
  desactivar,
  sucursales = null,
}: PropsDePantallaDeFichaDeUsuario) {
  return (
    <div className={estilos["cuerpo"]}>
      <dl className={estilos["datos"]}>
        {ficha.renglones.map((r) => (
          <div key={r.rotulo} className={estilos["dato"]}>
            <dt>{r.rotulo}</dt>
            <dd>
              {r.insignia === null ? (
                r.valor
              ) : (
                <Insignia tono={r.insignia.tono}>{r.insignia.texto}</Insignia>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {sucursales === null ? null : (
        <FormularioDeSucursalesDeUsuario
          // Al cambiar lo guardado (lo propio o lo de otra persona) el bloque arranca de nuevo con lo que dice el servidor.
          key={sucursales.editor.opciones
            .filter((o) => o.marcada)
            .map((o) => o.id)
            .join("|")}
          accion={sucursales.accion}
          editor={sucursales.editor}
        />
      )}
      {ficha.desactivar === null || desactivar === undefined ? null : (
        <div className={estilos["acciones"]}>
          <ConfirmacionDeDesactivar accion={desactivar} textos={ficha.desactivar} />
        </div>
      )}
    </div>
  );
}
