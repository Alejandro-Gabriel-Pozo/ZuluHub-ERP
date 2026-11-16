import { useId, type ReactNode, type Ref } from "react";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import type { ClaveDeTexto } from "../../../../../src/capacidades/vocabulario/catalogo";
import { Boton } from "../../componentes/Boton.cliente";
import { Texto } from "../../primitivas/Texto";
import type { ControlVisto } from "./modelo-del-cierre";
import estilos from "./PantallaDelCierre.module.css";

type Severidad = "bloquea" | "reconocible" | "informa";

const TITULO = {
  bloquea: "cierre.severidad.bloquea",
  reconocible: "cierre.severidad.reconocible",
  informa: "cierre.severidad.informa",
} as const satisfies Readonly<Record<Severidad, ClaveDeTexto>>;

type PropsDelGrupo = Readonly<{
  severidad: "bloquea" | "reconocible";
  /** El título del grupo puede ser el título del paso (el 3): recibe el foco al llegar. */
  tituloRef?: Ref<HTMLHeadingElement>;
  controles: readonly ControlVisto[];
  /** Solo en «Hay que reconocer», con el día en cierre: cada control se marca para reconocerlo al cerrar. */
  marcable?: Readonly<{
    marcado: (control: ControlVisto) => boolean;
    alTocar: (control: ControlVisto) => void;
    deshabilitado: boolean;
  }>;
}>;

function Constancia({ control }: Readonly<{ control: ControlVisto }>) {
  return (
    <>
      {control.constancia === null ? null : <Texto variante="suave">{control.constancia}</Texto>}
      {control.observacion === null ? null : <Texto variante="suave">{control.observacion}</Texto>}
    </>
  );
}

/** Una tarjeta de control: un grupo accesible con su rótulo y su cantidad como nombre y, si hay, las filas del detalle, la constancia y el botón. */
function Tarjeta({ control, boton }: Readonly<{ control: ControlVisto; boton?: ReactNode }>) {
  const idDelTitulo = useId();
  return (
    <li className={estilos["item"]}>
      <div role="group" aria-labelledby={idDelTitulo} className={estilos["tarjeta"]}>
        <span id={idDelTitulo} className={estilos["titulo"]}>
          {control.rotulo} · {control.cantidad}
        </span>
        {control.detalle.map((fila) => (
          <span key={fila} className={estilos["suave"]}>
            {fila}
          </span>
        ))}
        <Constancia control={control} />
        {boton}
      </div>
    </li>
  );
}

/**
 * Un grupo de controles con su título aprobado: «Impide cerrar» (arriba de todo, en cualquier paso donde exista) o «Hay que reconocer» (con «Reconocer» por control, solo con el día en
 * cierre). Un grupo sin controles no se dibuja. El título dice la severidad una vez por grupo, no en cada tarjeta (maqueta aceptada, `cierre-del-dia-claridad.md` §2).
 */
export function GrupoDeControles({ severidad, tituloRef, controles, marcable }: PropsDelGrupo) {
  if (controles.length === 0) return null;
  return (
    <section className={estilos["grupo"]} data-severidad={severidad}>
      <h2
        ref={tituloRef}
        tabIndex={tituloRef === undefined ? undefined : -1}
        className={estilos["tituloDelGrupo"]}
      >
        {texto({}, TITULO[severidad])}
      </h2>
      <ul className={estilos["lista"]}>
        {controles.map((control) => (
          <Tarjeta
            key={control.clave}
            control={control}
            boton={
              marcable === undefined ? undefined : (
                <Boton
                  variante="secundaria"
                  presionado={marcable.marcado(control)}
                  deshabilitado={marcable.deshabilitado}
                  alTocar={() => {
                    marcable.alTocar(control);
                  }}
                >
                  {marcable.marcado(control)
                    ? `✓ ${texto({}, "cierre.reconocer")}`
                    : texto({}, "cierre.reconocer")}
                </Boton>
              )
            }
          />
        ))}
      </ul>
    </section>
  );
}

/** «Solo informa · n»: plegado por defecto, con el rótulo aprobado como resumen y cada control con su cantidad. */
export function ControlesQueSoloInforman({
  controles,
}: Readonly<{ controles: readonly ControlVisto[] }>) {
  if (controles.length === 0) return null;
  return (
    <details className={estilos["plegable"]}>
      <summary>
        {texto({}, TITULO.informa)} · {controles.length}
      </summary>
      <div className={estilos["plegableCuerpo"]}>
        {controles.map((control) => (
          <div key={control.clave} className={estilos["renglon"]}>
            <span>{control.rotulo}</span>
            <strong className={estilos["monto"]}>{control.cantidad}</strong>
          </div>
        ))}
      </div>
    </details>
  );
}
