import { useId } from "react";
import type { DatoDeCampo } from "../../../../src/capacidades/datos/registro";
import estilos from "./Casilla.module.css";

export type PropsDeCasilla = Readonly<{
  /** Qué dato pide la casilla: un `IdDeDato` del registro de datos o `"pendiente"` (deuda registrada). Obligatorio: sin dato no hay campo. */
  dato: DatoDeCampo;
  /** El texto visible que nombra la casilla (siempre visible). */
  etiqueta: string;
  marcada: boolean;
  alCambiar: (marcada: boolean) => void;
  /** El nombre con el que viaja en el formulario: marcada manda `"on"`, desmarcada no manda nada (lo de siempre de una casilla del navegador). */
  nombre?: string | undefined;
}>;

/**
 * Casilla de verificación nativa con su etiqueta: para un sí o un no del negocio (por ejemplo «Obligatorio»). El área tocable es toda la fila (objetivo mínimo). Es un componente de
 * campo (`COMPONENTES_DE_CAMPO`): quien la usa dice qué dato pide.
 */
export function Casilla({ etiqueta, marcada, alCambiar, nombre }: PropsDeCasilla) {
  const id = useId();
  return (
    <label htmlFor={id} className={estilos["fila"]}>
      <input
        id={id}
        className={estilos["casilla"]}
        type="checkbox"
        name={nombre}
        checked={marcada}
        onChange={(evento) => {
          alCambiar(evento.target.checked);
        }}
      />
      <span>{etiqueta}</span>
    </label>
  );
}
