"use client";

import { Boton } from "../../componentes/Boton.cliente";
import estilos from "./PantallaDeLaMesa.module.css";

export type PropsDeAccionesDeLaMesa = Readonly<{
  textos: Readonly<{ cobrar: string; liberar: string; cambiarDeMesa: string }>;
  /** Una acción está en vuelo: ninguna otra sale. */
  ocupado: boolean;
  /** «Cobrar» se ofrece solo a quien puede (ayuda: el servidor decide). */
  puedeCobrar: boolean;
  /** «Cobrar» queda apagado mientras haya platos para enviar o que esperan, sin platos o sin un total en pesos: es un ESTADO, sin texto nuevo. */
  cobrarApagado: boolean;
  alCobrar: () => void;
  /** «Liberar mesa» solo en una mesa sin platos. */
  sinPlatos: boolean;
  alLiberar: () => void;
  /** «Cambiar de mesa» solo a quien puede. */
  puedeCambiarDeMesa: boolean;
  alCambiarDeMesa: () => void;
}>;

/** Las acciones de la mesa con cuenta (SAL-B y SAL-D): «Cobrar», «Liberar mesa» y «Cambiar de mesa». Sin textos propios: todos llegan resueltos. */
export function AccionesDeLaMesa({
  textos,
  ocupado,
  puedeCobrar,
  cobrarApagado,
  alCobrar,
  sinPlatos,
  alLiberar,
  puedeCambiarDeMesa,
  alCambiarDeMesa,
}: PropsDeAccionesDeLaMesa) {
  return (
    <div className={estilos["acciones"]}>
      {puedeCobrar ? (
        <Boton deshabilitado={ocupado || cobrarApagado} alTocar={alCobrar}>
          {textos.cobrar}
        </Boton>
      ) : null}
      {sinPlatos ? (
        <Boton variante="secundaria" deshabilitado={ocupado} alTocar={alLiberar}>
          {textos.liberar}
        </Boton>
      ) : null}
      {puedeCambiarDeMesa ? (
        <Boton variante="secundaria" deshabilitado={ocupado} alTocar={alCambiarDeMesa}>
          {textos.cambiarDeMesa}
        </Boton>
      ) : null}
    </div>
  );
}
