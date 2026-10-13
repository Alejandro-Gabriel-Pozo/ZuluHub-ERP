import type { ReactNode } from "react";
import estilos from "./Pila.module.css";

export type PropsDePila = Readonly<{
  children: ReactNode;
  /** Separación entre hijos, de la escala de espacio (1 a 6). */
  separacion?: 1 | 2 | 3 | 4 | 5 | 6;
  direccion?: "columna" | "fila";
  alinear?: "inicio" | "centro" | "fin" | "estirar";
  envolver?: boolean;
}>;

/** Caja que apila a sus hijos con una separación de la escala. No tiene significado propio. */
export function Pila({
  children,
  separacion = 3,
  direccion = "columna",
  alinear = "estirar",
  envolver = false,
}: PropsDePila) {
  return (
    <div
      className={estilos["pila"]}
      data-separacion={separacion}
      data-direccion={direccion}
      data-alinear={alinear}
      data-envolver={envolver}
    >
      {children}
    </div>
  );
}
