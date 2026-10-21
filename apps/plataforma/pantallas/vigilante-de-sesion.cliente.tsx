"use client";

import { useEffect, useState } from "react";
import type { EstadoDeSesionDePlataforma } from "../../../src/capacidades/autenticacion/estado-de-sesion-de-plataforma";
import { AvisoDeSesion } from "../../web/ui/patrones/AvisoDeSesion";
import { avisoDeSesion, type AvisoDeSesion as Aviso } from "../logica/aviso-de-sesion";

const CADA_CUANTO_MS = 30_000;

/** Lo que dice el servidor, o `null` si no se pudo leer (no se inventa un estado). */
async function leerEstado(
  ruta: "estado-de-sesion" | "get-session",
): Promise<EstadoDeSesionDePlataforma | null> {
  try {
    const respuesta = await fetch(`/api/auth/${ruta}`, { cache: "no-store" });
    if (respuesta.status === 401) {
      return {
        vigente: false,
        venceEnMs: 0,
        motivo: "INACTIVIDAD",
        segundoFactorRecienteHastaMs: 0,
      };
    }
    if (!respuesta.ok) return null;
    return (await respuesta.json()) as EstadoDeSesionDePlataforma;
  } catch {
    return null;
  }
}

const TEXTOS_RENOVABLE = {
  avisoTitulo: "¿Seguís ahí?",
  avisoDetalle: "Por seguridad, la sesión se cierra a los 30 minutos sin uso. Faltan unos minutos.",
  seguir: "Seguir",
  vencidaTitulo: "La sesión venció",
  vencidaDetalle: "Ingresá de nuevo para seguir. No se perdió nada de lo que ya estaba guardado.",
  ingresarDeNuevo: "Ingresar de nuevo",
  cerrar: "Cerrar",
} as const;

const TEXTOS_SIN_RENOVAR = {
  ...TEXTOS_RENOVABLE,
  avisoTitulo: "La sesión se va a cerrar",
  avisoDetalle:
    "Una sesión dura 8 horas como máximo y esta no se puede extender. Terminá lo que estás haciendo y volvé a ingresar.",
  seguir: "Entendido",
} as const;

/** Mira el estado de la sesión cada 30 segundos (sin renovarla) y avisa antes de que venza. «Seguir» la renueva. */
export function VigilanteDeSesion() {
  const [aviso, setAviso] = useState<Aviso>("ninguno");
  const [descartado, setDescartado] = useState(false);

  useEffect(() => {
    let vivo = true;
    async function revisar() {
      const estado = await leerEstado("estado-de-sesion");
      if (vivo && estado !== null) setAviso(avisoDeSesion(estado));
    }
    void revisar();
    const temporizador = setInterval(() => void revisar(), CADA_CUANTO_MS);
    return () => {
      vivo = false;
      clearInterval(temporizador);
    };
  }, []);

  async function seguir() {
    if (aviso === "por-vencer-renovable") {
      const estado = await leerEstado("get-session");
      if (estado !== null) setAviso(avisoDeSesion(estado));
    } else {
      setDescartado(true);
    }
  }

  const estado =
    aviso === "vencida" ? "vencida" : aviso !== "ninguno" && !descartado ? "por-vencer" : "activa";
  return (
    <AvisoDeSesion
      estado={estado}
      textos={aviso === "por-vencer-sin-renovar" ? TEXTOS_SIN_RENOVAR : TEXTOS_RENOVABLE}
      alSeguir={() => void seguir()}
      alIngresar={() => {
        window.location.assign("/ingreso?error=sesion_vencida");
      }}
    />
  );
}
