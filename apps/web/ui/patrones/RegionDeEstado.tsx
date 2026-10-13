import type { ReactNode } from "react";
import estilos from "./RegionDeEstado.module.css";

export type PropsDeRegionDeEstado = Readonly<{
  /** Lo que se anuncia. Cuando cambia, el lector de pantalla lo lee (WCAG 4.1.3). */
  children?: ReactNode;
  /** `asertivo` interrumpe: solo para lo que bloquea (un error al cobrar). Lo demás, `cortes`. */
  urgencia?: "cortes" | "asertivo";
  /** Mientras hay algo en curso («Enviando…»): se anuncia como ocupada. */
  ocupada?: boolean;
  /** Visible en pantalla o solo para el lector. */
  visible?: boolean;
}>;

/**
 * Región viva para mensajes de estado (éxito informativo, «Enviando…», resultado). Siempre está en el
 * árbol, aunque vacía: una región que aparece junto con su texto muchas veces no se anuncia. Un error
 * que pide hacer algo NO va en una tostada que se va: va en un `Aviso` en contexto.
 */
export function RegionDeEstado({
  children,
  urgencia = "cortes",
  ocupada = false,
  visible = true,
}: PropsDeRegionDeEstado) {
  return (
    <div
      className={visible ? estilos["visible"] : estilos["soloLector"]}
      role={urgencia === "asertivo" ? "alert" : "status"}
      aria-live={urgencia === "asertivo" ? "assertive" : "polite"}
      aria-atomic="true"
      aria-busy={ocupada ? "true" : undefined}
    >
      {children}
    </div>
  );
}
