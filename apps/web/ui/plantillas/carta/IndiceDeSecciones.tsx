import type { VistaDeSeccion } from "../../../../../src/capacidades/experiencia/carta/vista";
import type { TextosDeCarta } from "../../../../../src/capacidades/experiencia/carta/textos";
import { Icono } from "../../iconos/Icono";
import estilos from "./IndiceDeSecciones.module.css";

/** El ancla del índice: un nombre propio para que ninguna sección (cuyo ancla sale de su nombre) la pise. */
const ANCLA_DEL_INDICE = "pd-indice";

export type PropsDeIndiceDeSecciones = Readonly<{
  secciones: readonly VistaDeSeccion[];
  textos: TextosDeCarta;
}>;

/**
 * El índice de secciones (D2): un enlace por sección con la cantidad de productos. Son anclas comunes: sirven
 * sin JavaScript y llegar a una sección cuesta dos toques desde cualquier punto de la carta.
 */
export function IndiceDeSecciones({ secciones, textos }: PropsDeIndiceDeSecciones) {
  return (
    <nav id={ANCLA_DEL_INDICE} className={estilos["indice"]} aria-labelledby="pd-indice-titulo">
      <h2 id="pd-indice-titulo" className={estilos["titulo"]}>
        {textos.indiceTitulo}
      </h2>
      <ol className={estilos["lista"]}>
        {secciones.map((s) => (
          <li key={s.id}>
            <a href={`#${s.id}`} className={estilos["enlace"]}>
              <span>{s.nombre}</span>
              <span className={estilos["cantidad"]}>{s.productos.length}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** El botón flotante «Secciones»: un enlace al índice, siempre al alcance del pulgar (D5). */
export function BotonFlotanteDeSecciones({ textos }: Readonly<{ textos: TextosDeCarta }>) {
  return (
    <a href={`#${ANCLA_DEL_INDICE}`} className={estilos["flotante"]} aria-label={textos.indiceIr}>
      <Icono clave="secciones" decorativo />
      <span aria-hidden="true">{textos.indiceTitulo}</span>
    </a>
  );
}
