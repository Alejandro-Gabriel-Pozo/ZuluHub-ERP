"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { aplicarEstilos } from "../../../primitivas/aplicar-estilos";
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
  const escalado = useRef<HTMLDivElement>(null);
  const contenido = useRef<HTMLDivElement>(null);
  const [disponible, setDisponible] = useState(0);
  const [alto, setAlto] = useState(0);
  const escala = escalaPara(disponible, anchoNatural);
  // Va ANTES del efecto que mide: el alto de `contenido` depende del ancho que se le pone acá.
  useLayoutEffect(() => {
    aplicarEstilos(escalado.current, {
      width: `${anchoNatural * escala}px`,
      height: `${alto * escala}px`,
    });
    aplicarEstilos(contenido.current, {
      width: `${anchoNatural}px`,
      transform: `scale(${escala})`,
    });
  }, [anchoNatural, escala, alto]);
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
  return (
    <div ref={marco} className={estilos["marco"]} data-vista-previa="">
      <div ref={escalado} className={estilos["escalado"]}>
        <div ref={contenido} className={estilos["contenido"]} data-escala={escala}>
          {children}
        </div>
      </div>
    </div>
  );
}
