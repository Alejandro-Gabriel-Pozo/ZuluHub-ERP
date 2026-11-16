"use client";

import type { ReactNode } from "react";
import { useEnvioDeFormulario } from "../../patrones/EnvioDeFormulario.cliente";
import estilos from "./PantallasDeSecciones.module.css";

export type PropsDeBotonDeFilaDeProducto = Readonly<{
  /** El nombre con el que viaja el toque (`CAMPO_DE_QUITAR` o `CAMPO_DE_AGREGAR`); su valor es el id del producto tocado. */
  campo: string;
  valor: string;
  /** Si la persona no puede (sin permiso, o el producto falta completarlo): solo una ayuda, el guard decide (DEC-0346). */
  apagado: boolean;
  /** `enlace` para «Quitar» (texto suelto a la derecha de la fila); `fila` para un candidato (toda la fila es el botón). */
  forma: "enlace" | "fila";
  children: ReactNode;
}>;

/**
 * Un botón de envío que lleva el id del producto tocado en su `name`/`value` (no es un campo de entrada). Mientras la acción corre ignora el segundo toque (sin `disabled`, para no perder el foco),
 * así el doble toque no manda dos pedidos; lo que evita el duplicado de verdad es la regla de repetición del caso de uso (`editarProducto` repetido es éxito sin escribir). Hay uno por producto en
 * un solo formulario.
 */
export function BotonDeFilaDeProducto({
  campo,
  valor,
  apagado,
  forma,
  children,
}: PropsDeBotonDeFilaDeProducto) {
  const enviando = useEnvioDeFormulario();
  return (
    <button
      type="submit"
      className={estilos[forma === "enlace" ? "quitar" : "candidato"]}
      name={campo}
      value={valor}
      disabled={apagado}
      aria-disabled={enviando ? "true" : undefined}
      onClick={(evento) => {
        if (enviando) evento.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
