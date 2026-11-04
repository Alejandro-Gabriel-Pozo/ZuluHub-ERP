"use client";

import type { ReactNode } from "react";
import type { LetraBase } from "../../../../../src/capacidades/experiencia/vidriera/letra";
import estilos from "./EscalaDeLetra.module.css";
import { usePasoDeLetra } from "./usePasoDeLetra";

/**
 * Pone la letra de la carta (`letra_base` y el paso que el comensal ya eligió) a lo que envuelve. Lo usa la
 * página de un producto, que no tiene el control «Letra» pero respeta el paso recordado.
 */
export function ContenedorDeLetra({
  letraBase,
  children,
}: Readonly<{ letraBase: LetraBase; children: ReactNode }>) {
  const [paso] = usePasoDeLetra();
  return (
    <div className={estilos["escala"]} data-letra-base={letraBase} data-letra={paso}>
      {children}
    </div>
  );
}
