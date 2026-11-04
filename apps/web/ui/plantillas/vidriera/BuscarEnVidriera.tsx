import { useId, useRef } from "react";
import type { TextosDeVidriera } from "../../../../../src/capacidades/experiencia/vidriera/textos";
import { Icono } from "../../iconos/Icono";
import { BotonIcono } from "../../componentes/BotonIcono";
import { RegionDeEstado } from "../../patrones/RegionDeEstado";
import estilos from "./BuscarEnVidriera.module.css";

export type PropsDeBuscarEnVidriera = Readonly<{
  consulta: string;
  alCambiar: (consulta: string) => void;
  /** Lo que se anuncia y se ve debajo del campo: la cantidad de resultados (vacío si no se busca nada). */
  anuncio: string;
  textos: TextosDeVidriera;
}>;

/**
 * «Buscar en la carta» (D8): filtra en el navegador, así que lo escrito no sale del celular. El campo es un
 * `search` con etiqueta visible; la cantidad de resultados se anuncia en una región de estado y «Limpiar»
 * vuelve el foco al campo.
 */
export function BuscarEnVidriera({
  consulta,
  alCambiar,
  anuncio,
  textos,
}: PropsDeBuscarEnVidriera) {
  const idDelCampo = useId();
  const campo = useRef<HTMLInputElement>(null);
  return (
    <div className={estilos["raiz"]} role="search">
      <label htmlFor={idDelCampo} className={estilos["etiqueta"]}>
        <Icono clave="buscar" decorativo tamano="chico" /> {textos.buscarEtiqueta}
      </label>
      <div className={estilos["fila"]}>
        <input
          ref={campo}
          id={idDelCampo}
          type="search"
          className={estilos["campo"]}
          value={consulta}
          autoComplete="off"
          enterKeyHint="search"
          onChange={(evento) => {
            alCambiar(evento.target.value);
          }}
        />
        {consulta === "" ? null : (
          <BotonIcono
            etiqueta={textos.buscarLimpiar}
            icono="cerrar"
            alTocar={() => {
              alCambiar("");
              campo.current?.focus();
            }}
          />
        )}
      </div>
      <RegionDeEstado>{anuncio}</RegionDeEstado>
    </div>
  );
}
