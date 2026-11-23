"use client";

import { useState } from "react";
import estilos from "./IdentidadDeLaCarta.module.css";

/**
 * El logo de la carta sobre la placa (§5.7.5): decorativo (el nombre está al lado) y, si la imagen falla, no se muestra y queda la inicial de abajo: nunca el ícono roto.
 * Es lo único de la identidad que necesita el navegador (saber si cargó), por eso vive aparte en un archivo de cliente.
 */
export function LogoDeLaPlaca({ direccion }: Readonly<{ direccion: string }>) {
  const [fallo, setFallo] = useState(false);
  if (fallo) return null;
  return (
    <img
      ref={(img) => {
        // Una imagen que ya falló antes de hidratar no dispara `onError`: se mira acá.
        if (img?.complete === true && img.naturalWidth === 0) setFallo(true);
      }}
      className={estilos["logo"]}
      src={direccion}
      alt=""
      data-logo=""
      onError={() => setFallo(true)}
    />
  );
}
