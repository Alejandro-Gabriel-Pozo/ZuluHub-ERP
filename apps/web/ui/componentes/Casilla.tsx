import { useId } from "react";
import type { DatoDeCampo } from "../../../../src/capacidades/datos/registro";
import estilos from "./Casilla.module.css";

export type PropsDeCasilla = Readonly<{
  /** Qué dato fija la casilla: un `IdDeDato` del registro de datos o `"pendiente"` (deuda registrada). Obligatorio: sin dato no hay campo. */
  dato: DatoDeCampo;
  etiqueta: string;
  marcada: boolean;
  alCambiar: (marcada: boolean) => void;
  /** Nombre del campo del formulario; con `valor`, viaja solo si está marcada (varias casillas pueden compartir el nombre). */
  nombre?: string | undefined;
  valor?: string | undefined;
  deshabilitada?: boolean;
}>;

/** Casilla de verificación con la etiqueta visible al lado (un solo objetivo táctil). El estado lo guarda quien la usa. */
export function Casilla({
  etiqueta,
  marcada,
  alCambiar,
  nombre,
  valor,
  deshabilitada = false,
}: PropsDeCasilla) {
  const id = useId();
  return (
    <div className={`${estilos["casilla"]} ${deshabilitada ? estilos["deshabilitada"] : ""}`}>
      <input
        id={id}
        className={estilos["control"]}
        type="checkbox"
        name={nombre}
        value={valor}
        checked={marcada}
        disabled={deshabilitada}
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
