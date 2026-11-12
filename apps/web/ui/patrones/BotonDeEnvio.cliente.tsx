"use client";

import { Boton, type PropsDeBoton } from "../componentes/Boton.cliente";
import { useEnvioDeFormulario } from "./EnvioDeFormulario.cliente";

export type PropsDeBotonDeEnvio = Readonly<
  Pick<PropsDeBoton, "children" | "variante" | "ancho"> & {
    /** Lo que dice mientras envía («Entrando…»). Sin él, conserva su texto y solo ignora el segundo toque. */
    textoEnviando?: string;
  }
>;

/**
 * El botón de enviar de un formulario con acción del servidor: mientras la acción corre dice
 * `textoEnviando` y NO se puede volver a tocar (el segundo toque no manda un segundo envío). Lo que
 * evita el duplicado de verdad es la regla de repetición de cada acción (ADR-015): este botón es la ayuda.
 */
export function BotonDeEnvio({ children, textoEnviando, variante, ancho }: PropsDeBotonDeEnvio) {
  const enviando = useEnvioDeFormulario();
  return (
    <Boton
      tipo="submit"
      enviando={enviando}
      {...(textoEnviando === undefined ? {} : { textoEnviando })}
      {...(variante === undefined ? {} : { variante })}
      {...(ancho === undefined ? {} : { ancho })}
    >
      {children}
    </Boton>
  );
}
