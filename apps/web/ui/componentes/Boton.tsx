import { useId, type ReactNode } from "react";
import estilos from "./Boton.module.css";

export type PropsDeBoton = Readonly<{
  /** El texto del botón, ya resuelto: dice el verbo («Cobrar $ 12.345,00»), no «Aceptar». */
  children: ReactNode;
  variante?: "primaria" | "secundaria" | "peligro";
  tipo?: "button" | "submit";
  alTocar?: (() => void) | undefined;
  deshabilitado?: boolean;
  /** Por qué no se puede tocar. Se ve junto al botón y lo describe para el lector de pantalla. */
  motivo?: string | undefined;
  /** Mientras envía el botón no se puede volver a tocar y dice `textoEnviando` («Enviando…»). */
  enviando?: boolean;
  textoEnviando?: string | undefined;
  ancho?: "auto" | "completo";
}>;

export function Boton({
  children,
  variante = "primaria",
  tipo = "button",
  alTocar,
  deshabilitado = false,
  motivo,
  enviando = false,
  textoEnviando,
  ancho = "auto",
}: PropsDeBoton) {
  const idDelMotivo = useId();
  const hayMotivo = motivo !== undefined && motivo !== "";
  return (
    <span className={estilos["envoltura"]} data-ancho={ancho}>
      <button
        type={tipo}
        className={estilos["boton"]}
        data-variante={variante}
        disabled={deshabilitado}
        // Enviando: no se usa `disabled` para no perder el foco; el toque se ignora y se anuncia.
        aria-disabled={enviando ? "true" : undefined}
        aria-busy={enviando ? "true" : undefined}
        aria-describedby={hayMotivo ? idDelMotivo : undefined}
        onClick={(evento) => {
          if (enviando) {
            evento.preventDefault();
            return;
          }
          alTocar?.();
        }}
      >
        {enviando && textoEnviando !== undefined ? textoEnviando : children}
      </button>
      {hayMotivo ? (
        <span id={idDelMotivo} className={estilos["motivo"]}>
          {motivo}
        </span>
      ) : null}
    </span>
  );
}
