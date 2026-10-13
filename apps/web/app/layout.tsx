import type { Viewport } from "next";
import type { ReactNode } from "react";

// Sin `maximumScale` ni `userScalable`: el zoom del navegador nunca se bloquea (accesibilidad).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function LayoutRaiz({ children }: { children: ReactNode }) {
  return (
    <html lang="es-AR">
      <body>{children}</body>
    </html>
  );
}
