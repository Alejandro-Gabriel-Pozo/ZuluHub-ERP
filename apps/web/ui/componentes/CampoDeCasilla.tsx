import { useId } from "react";
import type { DatoDeCampo } from "../../../../src/capacidades/datos/registro";
import estilos from "./CampoDeCasilla.module.css";

export type PropsDeCampoDeCasilla = Readonly<{
  /** Qué dato pide el campo: un `IdDeDato` del registro de datos o `"pendiente"` (deuda registrada). Obligatorio: sin dato no hay campo. */
  dato: DatoDeCampo;
  /** La etiqueta es visible SIEMPRE y es el nombre accesible de la casilla. */
  etiqueta: string;
  marcada: boolean;
  alCambiar: (marcada: boolean) => void;
  /** Con nombre, un formulario la envía como `nombre=on` solo si está marcada (lo normal de una casilla HTML). */
  nombre?: string | undefined;
  deshabilitado?: boolean;
}>;

/** Una casilla de sí o no (`<input type="checkbox">`) con su etiqueta visible al lado. Para elegir entre varias opciones está `Selector`. */
export function CampoDeCasilla({
  etiqueta,
  marcada,
  alCambiar,
  nombre,
  deshabilitado = false,
}: PropsDeCampoDeCasilla) {
  const id = useId();
  return (
    <div className={estilos["fila"]}>
      <input
        id={id}
        className={estilos["casilla"]}
        type="checkbox"
        name={nombre}
        checked={marcada}
        disabled={deshabilitado}
        onChange={(evento) => {
          alCambiar(evento.target.checked);
        }}
      />
      <label htmlFor={id} className={estilos["etiqueta"]}>
        {etiqueta}
      </label>
    </div>
  );
}
