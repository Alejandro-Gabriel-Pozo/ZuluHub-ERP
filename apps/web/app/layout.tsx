import type { Viewport } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";

// Sin `maximumScale` ni `userScalable`: el zoom del navegador nunca se bloquea (accesibilidad).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

// Toda página se arma en cada pedido: cambia con el host y lleva el nonce de la CSP, que es de ese
// pedido. Una página prerenderizada no tendría nonce (sus scripts no correrían) y se serviría igual a
// todos los hosts.
export default async function LayoutRaiz({ children }: { children: ReactNode }) {
  await connection();
  return (
    <html lang="es-AR">
      <body>{children}</body>
    </html>
  );
}
