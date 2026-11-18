"use client";

import { useState } from "react";
import { Boton } from "../../componentes/Boton.cliente";
import { Pila } from "../../primitivas/Pila";
import { Qr } from "../facturacion/impresion/PiezasDeLaHoja";
import estilos from "./PantallaDeCartaEnLinea.module.css";
import type { CartaEnLineaArmada } from "./modelo-de-carta-en-linea";

export type PropsDeDireccionDeLaCarta = Readonly<{
  direccion: NonNullable<CartaEnLineaArmada["direccion"]>;
}>;

/**
 * La dirección pública de la carta, el QR y sus dos botones (maqueta `carta-en-linea.html`). «Copiar» copia la dirección y avisa «Enlace copiado» (si el navegador no deja copiar, no avisa: no
 * se dice algo que no pasó). «Descargar QR» baja el QR como SVG: es un enlace de descarga, así que tocarlo dos veces seguidas baja un solo archivo por toque y no escribe nada en el servidor. El QR se
 * muestra como imagen, nunca como HTML. Sin logo todavía (otro tramo).
 */
export function DireccionDeLaCarta({ direccion }: PropsDeDireccionDeLaCarta) {
  const [copiado, setCopiado] = useState(false);
  const copiar = () => {
    // Sin API del portapapeles (o sin permiso) no se avisa: no se dice «copiado» si no se copió.
    navigator.clipboard
      ?.writeText(direccion.valor)
      .then(() => setCopiado(true))
      .catch(() => setCopiado(false));
  };
  return (
    <Pila separacion={3}>
      <h2 className={estilos["subtitulo"]}>{direccion.titulo}</h2>
      <p className={estilos["direccion"]}>{direccion.valor}</p>
      <div className={estilos["acciones"]}>
        <Boton variante="secundaria" alTocar={copiar}>
          {direccion.copiar}
        </Boton>
      </div>
      <p role="status" className={estilos["aviso"]}>
        {copiado ? direccion.copiado : ""}
      </p>
      {direccion.qrSvg === null ? null : (
        <>
          <Qr qrSvg={direccion.qrSvg} clase={estilos["qr"] ?? ""} />
          <a
            className={estilos["secundario"]}
            href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(direccion.qrSvg)}`}
            download="qr-de-la-carta.svg"
          >
            {direccion.descargar}
          </a>
        </>
      )}
      {direccion.noDisponible === null ? null : <p>{direccion.noDisponible}</p>}
    </Pila>
  );
}
