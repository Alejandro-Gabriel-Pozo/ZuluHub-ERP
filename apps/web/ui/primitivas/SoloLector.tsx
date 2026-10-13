import type { ReactNode } from "react";
import estilos from "./SoloLector.module.css";

/** Texto que solo anuncian los lectores de pantalla (no se ve, pero sigue en el árbol de accesibilidad). */
export function SoloLector({ children }: Readonly<{ children: ReactNode }>) {
  return <span className={estilos["soloLector"]}>{children}</span>;
}
