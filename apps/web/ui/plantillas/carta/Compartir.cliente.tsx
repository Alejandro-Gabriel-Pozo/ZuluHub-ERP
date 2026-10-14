"use client";

import { useState } from "react";
import type { TextosDeCarta } from "../../../../../src/capacidades/experiencia/carta/textos";
import { Boton } from "../../componentes/Boton";
import { Icono } from "../../iconos/Icono";
import { RegionDeEstado } from "../../patrones/RegionDeEstado";
import estilos from "./Compartir.module.css";

export type PropsDeCompartir = Readonly<{
  /** La dirección del producto (`href` de la vista): con la del sitio donde se está queda un enlace completo. */
  enlace: string;
  /** El nombre del producto: el título de la hoja de compartir del sistema. */
  titulo: string;
  textos: TextosDeCarta;
}>;

/**
 * «Compartir» (§3.1): abre la hoja de compartir del sistema si existe (`navigator.share`); si no, copia el
 * enlace y lo anuncia en una región de estado («Enlace copiado»). Si el usuario cierra la hoja del sistema,
 * no pasa nada: cancelar no es un error.
 */
export function Compartir({ enlace, titulo, textos }: PropsDeCompartir) {
  const [mensaje, setMensaje] = useState("");

  async function copiar(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setMensaje(textos.enlaceCopiado);
    } catch {
      setMensaje(textos.enlaceNoCopiado);
    }
  }

  async function compartir() {
    const url = new URL(enlace, window.location.href).toString();
    if (typeof navigator.share !== "function") {
      await copiar(url);
      return;
    }
    try {
      await navigator.share({ title: titulo, url });
    } catch (error) {
      // El usuario cerró la hoja del sistema: no hay nada que decir ni que copiar.
      if (error instanceof DOMException && error.name === "AbortError") return;
      await copiar(url);
    }
  }

  return (
    <div className={estilos["raiz"]}>
      <Boton
        variante="secundaria"
        ancho="completo"
        alTocar={() => {
          void compartir();
        }}
      >
        <Icono clave="compartir" decorativo />
        {" "}
        {textos.compartir}
      </Boton>
      <RegionDeEstado>{mensaje}</RegionDeEstado>
    </div>
  );
}
