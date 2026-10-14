"use client";

import { useState } from "react";
import type { VistaDeFoto } from "../../../../../src/capacidades/experiencia/carta/vista";
import estilos from "./FotoDeProducto.module.css";

export type PropsDeFotoDeProducto = Readonly<{
  foto: VistaDeFoto;
  /** `miniatura` es la de la lista (72 x 54 px a la derecha); `grande` es la de la tarjeta, a todo el ancho. */
  tamano: "miniatura" | "grande";
  /** En la lista la foto es decorativa (el nombre está al lado); en la tarjeta lleva su texto alternativo. */
  decorativa: boolean;
  /** Las del primer pantallazo cargan ya; el resto, cuando se acercan (D6). */
  prioridad: boolean;
}>;

/**
 * Una foto de producto dentro de una caja de proporción fija 4:3. Siempre trae `width` y `height` (CLS) y,
 * si la imagen falla, la caja se queda con su color de superficie y sin la imagen: nunca el ícono roto.
 */
export function FotoDeProducto({ foto, tamano, decorativa, prioridad }: PropsDeFotoDeProducto) {
  const [fallo, setFallo] = useState(false);
  return (
    <span
      className={[estilos["caja"], estilos[tamano]].join(" ")}
      data-estado={fallo ? "rota" : "ok"}
    >
      {fallo ? null : (
        <img
          ref={(img) => {
            // Una imagen que ya falló antes de hidratar no dispara `onError`: se mira acá.
            if (img?.complete === true && img.naturalWidth === 0) setFallo(true);
          }}
          className={estilos["imagen"]}
          src={foto.direccion}
          alt={decorativa ? "" : foto.alt}
          width={foto.ancho}
          height={foto.alto}
          loading={prioridad ? "eager" : "lazy"}
          decoding="async"
          onError={() => {
            setFallo(true);
          }}
        />
      )}
    </span>
  );
}
