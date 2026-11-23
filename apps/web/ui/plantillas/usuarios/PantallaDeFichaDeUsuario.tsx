import { Insignia } from "../../componentes/Insignia";
import type { FichaDeUsuarioArmada } from "./modelo-de-usuarios";
import estilos from "./PantallaDeUsuarios.module.css";

export type PropsDePantallaDeFichaDeUsuario = Readonly<{ ficha: FichaDeUsuarioArmada }>;

/**
 * La ficha de una persona (maqueta `usuarios.html`, `vUsuario`), de solo lectura: el email es el título de la pantalla (lo pone la página) y debajo van el rol y el estado. Sin botones: los suman los tramos que
 * desactivan y asignan sucursales. El estado se dice con texto en su insignia. Sin estado ni hooks: es una página de servidor.
 */
export function PantallaDeFichaDeUsuario({ ficha }: PropsDePantallaDeFichaDeUsuario) {
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
    </div>
  );
}
