"use client";

import { useState } from "react";
import { Aviso } from "../../web/ui/componentes/Aviso";
import { Boton } from "../../web/ui/componentes/Boton";
import { Texto } from "../../web/ui/primitivas/Texto";
import { TEXTO_NEUTRO_DE_INGRESO } from "../logica/ingreso";

const ORIGEN_DE_GOOGLE = "https://accounts.google.com/";

/**
 * «Ingresar con Google»: pide la dirección al servidor y va hacia ella. Solo se sigue una dirección de Google; cualquier
 * otra respuesta (un error, una dirección rara) dice el texto neutro y no navega.
 */
export function IngresoConGoogle() {
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ingresar() {
    if (enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const respuesta = await fetch("/api/auth/sign-in/social", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "google" }),
      });
      const cuerpo: unknown = await respuesta.json();
      const url =
        typeof cuerpo === "object" && cuerpo !== null && "url" in cuerpo ? cuerpo.url : null;
      if (respuesta.ok && typeof url === "string" && url.startsWith(ORIGEN_DE_GOOGLE)) {
        window.location.assign(url);
        return;
      }
      setError(TEXTO_NEUTRO_DE_INGRESO);
    } catch {
      setError(TEXTO_NEUTRO_DE_INGRESO);
    }
    setEnviando(false);
  }

  return (
    <>
      {error === null ? null : (
        <Aviso tono="peligro">
          <Texto>{error}</Texto>
        </Aviso>
      )}
      <Boton
        ancho="completo"
        enviando={enviando}
        textoEnviando="Abriendo Google…"
        alTocar={() => void ingresar()}
      >
        Ingresar con Google
      </Boton>
    </>
  );
}
