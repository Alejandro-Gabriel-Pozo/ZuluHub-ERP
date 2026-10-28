import {
  PASOS_DE_LETRA,
  type PasoDeLetra,
} from "../../../../../src/capacidades/experiencia/vidriera/letra";
import type { TextosDeVidriera } from "../../../../../src/capacidades/experiencia/vidriera/textos";
import estilos from "./ControlDeLetra.module.css";

export type PropsDeControlDeLetra = Readonly<{
  paso: PasoDeLetra;
  alElegir: (paso: PasoDeLetra) => void;
  textos: TextosDeVidriera;
}>;

/**
 * El control «Letra» (D10): tres pasos visibles, de 48 x 48 px o más, que cambian el tamaño de toda la carta
 * sin depender del zoom del navegador. Es un grupo de botones con estado (`aria-pressed`), no un menú.
 */
export function ControlDeLetra({ paso, alElegir, textos }: PropsDeControlDeLetra) {
  const nombres: Record<PasoDeLetra, string> = {
    NORMAL: textos.letraNormal,
    GRANDE: textos.letraGrande,
    MUY_GRANDE: textos.letraMuyGrande,
  };
  return (
    <div className={estilos["raiz"]} role="group" aria-label={textos.letraGrupo}>
      <span className={estilos["etiqueta"]} aria-hidden="true">
        {textos.letraEtiqueta}
      </span>
      <div className={estilos["pasos"]}>
        {PASOS_DE_LETRA.map((p) => (
          <button
            key={p}
            type="button"
            className={estilos["paso"]}
            data-paso={p}
            aria-pressed={p === paso}
            aria-label={nombres[p]}
            onClick={() => {
              alElegir(p);
            }}
          >
            A
          </button>
        ))}
      </div>
    </div>
  );
}
