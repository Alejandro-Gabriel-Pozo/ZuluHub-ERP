import type { ReactNode } from "react";
import estilos from "./Texto.module.css";

export type PropsDeTexto = Readonly<{
  children: ReactNode;
  /** La etiqueta HTML: la elige quien arma la pantalla según la jerarquía de títulos. */
  como?: "p" | "span" | "h1" | "h2" | "h3";
  variante?: "cuerpo" | "suave" | "chico" | "subtitulo" | "titulo";
  id?: string;
}>;

/** Texto con la tipografía de los tokens. El texto llega ya resuelto: acá no se arma ni se traduce. */
export function Texto({ children, como = "p", variante = "cuerpo", id }: PropsDeTexto) {
  const Etiqueta = como;
  return (
    <Etiqueta className={estilos["texto"]} data-variante={variante} id={id}>
      {children}
    </Etiqueta>
  );
}
