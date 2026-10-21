import type { Viewport } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";
import "../../web/ui/tokens.css";

// Sin `maximumScale` ni `userScalable`: el zoom del navegador nunca se bloquea (accesibilidad).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export const metadata = {
  title: "Consola de plataforma",
  robots: { index: false, follow: false },
};

// Toda página se arma en cada pedido: lleva el nonce de la política de contenido, que es de ese pedido.
export default async function LayoutRaiz({ children }: { children: ReactNode }) {
  await connection();
  return (
    <html lang="es-AR">
      <body>{children}</body>
    </html>
  );
}
