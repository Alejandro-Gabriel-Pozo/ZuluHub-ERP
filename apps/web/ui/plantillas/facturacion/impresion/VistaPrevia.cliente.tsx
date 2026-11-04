"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { escalaPara } from "./geometria";
import estilos from "./VistaPrevia.module.css";

export type PropsDeLaVistaPrevia = Readonly<{
  /** El ancho natural de lo que se muestra (px de CSS): el de la hoja o el del ticket. */
  anchoNatural: number;
  children: ReactNode;
}>;

/**
 * La vista previa: la hoja entera, escalada al ancho que hay. Es DISTINTA de la tabla de medición (que no puede estar acá adentro: lo que
 * se mide dentro de un `transform` sale escalado). El ancho disponible y el alto de lo mostrado se leen con `ResizeObserver`.
 * Previene: una hoja cortada a la derecha en un celular, o un hueco en blanco debajo de la hoja escalada.
 */
export function VistaPrevia({ anchoNatural, children }: PropsDeLaVistaPrevia) {
  const marco = useRef<HTMLDivElement>(null);
  const contenido = useRef<HTMLDivElement>(null);
  const [disponible, setDisponible] = useState(0);
  const [alto, setAlto] = useState(0);
  useLayoutEffect(() => {
    const elMarco = marco.current;
    const elContenido = contenido.current;
    if (elMarco === null || elContenido === null) return;
    const leer = () => {
      setDisponible(elMarco.clientWidth);
      setAlto(elContenido.offsetHeight);
    };
    leer();
    const observador = new ResizeObserver(leer);
    observador.observe(elMarco);
    observador.observe(elContenido);
    return () => observador.disconnect();
  }, []);
  const escala = escalaPara(disponible, anchoNatural);
  return (
    <div ref={marco} className={estilos["marco"]} data-vista-previa="">
      <div
        className={estilos["escalado"]}
        style={{ width: anchoNatural * escala, height: alto * escala }}
      >
        <div
          ref={contenido}
          className={estilos["contenido"]}
          style={{ width: anchoNatural, transform: `scale(${escala})` }}
          data-escala={escala}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
