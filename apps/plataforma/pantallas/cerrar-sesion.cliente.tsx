"use client";

import { useState } from "react";
import { Boton } from "../../web/ui/componentes/Boton";

/** Cierra la sesión (`POST sign-out`) y vuelve al ingreso. Aunque el pedido falle, la persona vuelve al ingreso. */
export function CerrarSesion() {
  const [cerrando, setCerrando] = useState(false);
  async function cerrar() {
    if (cerrando) return;
    setCerrando(true);
    try {
      await fetch("/api/auth/sign-out", { method: "POST", cache: "no-store" });
    } finally {
      window.location.assign("/ingreso");
    }
  }
  return (
    <Boton
      variante="secundaria"
      enviando={cerrando}
      textoEnviando="Cerrando…"
      alTocar={() => void cerrar()}
    >
      Cerrar sesión
    </Boton>
  );
}
