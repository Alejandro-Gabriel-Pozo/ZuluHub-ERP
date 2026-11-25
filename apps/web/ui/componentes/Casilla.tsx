import { useEffect, useId, useRef } from "react";
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
  /** El valor con el que viaja marcada (para varias casillas con el mismo `nombre`, un valor por casilla); sin él, `"on"`. */
  valor?: string | undefined;
  /** Apagada: se ve con su estado real y no se puede cambiar (el navegador no la manda en el formulario). */
  apagada?: boolean | undefined;
}>;

/**
 * Casilla de verificación nativa con su etiqueta: para un sí o un no del negocio (por ejemplo «Obligatorio»). El área tocable es toda la fila (objetivo mínimo). Es un componente de
 * campo (`COMPONENTES_DE_CAMPO`): quien la usa dice qué dato pide.
 */
export function Casilla({ etiqueta, marcada, alCambiar, nombre, valor, apagada }: PropsDeCasilla) {
  const id = useId();
  const referencia = useRef<HTMLInputElement>(null);
  const ultima = useRef(marcada);
  useEffect(() => {
    ultima.current = marcada;
  }, [marcada]);
  // Al terminar una acción de formulario, React reinicia el formulario y el navegador desmarca la casilla aunque lo que la persona dejó siga siendo `marcada`: se vuelve a poner. Sin esto un guardado
  // rechazado dejaría la casilla mostrando lo contrario de lo que se eligió (y el siguiente envío mandaría eso).
  useEffect(() => {
    const formulario = referencia.current?.form;
    if (formulario === null || formulario === undefined) return;
    const alReiniciar = () => {
      queueMicrotask(() => {
        if (referencia.current !== null) referencia.current.checked = ultima.current;
      });
    };
    formulario.addEventListener("reset", alReiniciar);
    return () => {
      formulario.removeEventListener("reset", alReiniciar);
    };
  }, []);
  return (
    <label htmlFor={id} className={estilos["fila"]}>
      <input
        ref={referencia}
        id={id}
        className={estilos["casilla"]}
        type="checkbox"
        name={nombre}
        value={valor}
        checked={marcada}
        disabled={apagada === true}
        onChange={(evento) => {
          alCambiar(evento.target.checked);
        }}
      />
      <span>{etiqueta}</span>
    </label>
  );
}
