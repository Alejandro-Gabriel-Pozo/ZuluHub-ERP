import { Insignia } from "../../componentes/Insignia";
import {
  ConfirmacionDeDesactivar,
  type PropsDeConfirmacionDeDesactivar,
} from "./ConfirmacionDeDesactivar.cliente";
import type { FichaDeUsuarioArmada } from "./modelo-de-usuarios";
import estilos from "./PantallaDeUsuarios.module.css";

export type PropsDePantallaDeFichaDeUsuario = Readonly<{
  ficha: FichaDeUsuarioArmada;
  /** La acción de desactivar con el id ya ligado; solo se usa si la ficha ofrece «Desactivar». */
  desactivar?: PropsDeConfirmacionDeDesactivar["accion"];
}>;

/**
 * La ficha de una persona (maqueta `usuarios.html`, `vUsuario`): el email es el título de la pantalla (lo pone la página) y debajo van el rol y el estado. Al pie, «Desactivar» (con su confirmación) solo si el modelo la
 * ofrece (activa, no es el gerente, no es quien mira y quien mira tiene el permiso); «Reactivar» y las sucursales las suman otros tramos. El estado se dice con texto en su insignia. Es una página de servidor: lo interactivo
 * está en `ConfirmacionDeDesactivar.cliente.tsx`.
 */
export function PantallaDeFichaDeUsuario({ ficha, desactivar }: PropsDePantallaDeFichaDeUsuario) {
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
      {ficha.desactivar === null || desactivar === undefined ? null : (
        <div className={estilos["acciones"]}>
          <ConfirmacionDeDesactivar accion={desactivar} textos={ficha.desactivar} />
        </div>
      )}
    </div>
  );
}
