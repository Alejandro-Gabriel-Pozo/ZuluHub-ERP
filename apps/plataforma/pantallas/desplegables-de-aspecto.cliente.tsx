"use client";

import { Selector } from "../../web/ui/componentes/Selector";
import { Pila } from "../../web/ui/primitivas/Pila";
import type { CampoDeSubmarca } from "../logica/errores-de-plataforma";
import {
  ESQUINAS,
  ESTILOS,
  INGRESOS,
  SUPERFICIES,
  TITULOS,
  type AspectoDeSubmarca,
} from "../logica/submarca";
import propios from "./submarcas.module.css";

type ClaveDeAspecto = keyof AspectoDeSubmarca;

type PropsDeDesplegablesDeAspecto = Readonly<{
  aspecto: AspectoDeSubmarca;
  deshabilitado: boolean;
  textoDelCampo: (campo: CampoDeSubmarca) => string | undefined;
  alElegir: <K extends ClaveDeAspecto>(clave: K, valor: AspectoDeSubmarca[K] | undefined) => void;
}>;

/** Elige de una lista cerrada el valor tipado que corresponde al texto del desplegable. */
function elegir<T extends string>(
  opciones: readonly Readonly<{ valor: T }>[],
  texto: string,
): T | undefined {
  return opciones.find((o) => o.valor === texto)?.valor;
}

/** Los cinco desplegables del aspecto de la submarca, dentro de su grupo «Aspecto». */
export function DesplegablesDeAspecto({
  aspecto,
  deshabilitado,
  textoDelCampo,
  alElegir,
}: PropsDeDesplegablesDeAspecto) {
  return (
    <fieldset className={propios["grupo"]}>
      <legend className={propios["leyenda"]}>Aspecto</legend>
      <Pila separacion={4}>
        <Selector
          etiqueta="Estilo"
          nombre="estilo"
          opciones={ESTILOS}
          valor={aspecto.estilo}
          alCambiar={(v) => {
            alElegir("estilo", elegir(ESTILOS, v));
          }}
          error={textoDelCampo("estilo")}
          deshabilitado={deshabilitado}
        />
        <Selector
          etiqueta="Superficie"
          nombre="superficie"
          opciones={SUPERFICIES}
          valor={aspecto.superficie}
          alCambiar={(v) => {
            alElegir("superficie", elegir(SUPERFICIES, v));
          }}
          error={textoDelCampo("superficie")}
          deshabilitado={deshabilitado}
        />
        <Selector
          etiqueta="Esquinas"
          nombre="esquinas"
          opciones={ESQUINAS}
          valor={aspecto.esquinas}
          alCambiar={(v) => {
            alElegir("esquinas", elegir(ESQUINAS, v));
          }}
          error={textoDelCampo("esquinas")}
          deshabilitado={deshabilitado}
        />
        <Selector
          etiqueta="Títulos"
          nombre="titulos"
          opciones={TITULOS}
          valor={aspecto.titulos}
          alCambiar={(v) => {
            alElegir("titulos", elegir(TITULOS, v));
          }}
          error={textoDelCampo("titulos")}
          deshabilitado={deshabilitado}
        />
        <Selector
          etiqueta="Ingreso"
          nombre="ingreso"
          opciones={INGRESOS}
          valor={aspecto.ingreso}
          alCambiar={(v) => {
            alElegir("ingreso", elegir(INGRESOS, v));
          }}
          error={textoDelCampo("ingreso")}
          deshabilitado={deshabilitado}
        />
      </Pila>
    </fieldset>
  );
}
