import type { ReactNode } from "react";
import "../../web/ui/tokens.css";

export default function LayoutRaiz({ children }: { children: ReactNode }) {
  return (
    <html lang="es-AR">
      <body>{children}</body>
    </html>
  );
}
