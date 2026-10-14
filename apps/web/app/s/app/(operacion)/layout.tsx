import type { ReactNode } from "react";
import { ProveedorDeSesion } from "../../../../ui/patrones/ProveedorDeSesion.cliente";

// El mostrador: el estado de la sesión (aviso «¿Seguís ahí?», sesión vencida sin perder lo tipeado y renovación
// de la cookie) envuelve todas sus pantallas. La guarda de sesión y de empresa la hace CADA página
// (`pantallaDeOperacion`): Next no vuelve a correr un layout al navegar entre páginas que lo comparten.
export default function LayoutDeOperacion({ children }: { children: ReactNode }) {
  return (
    <ProveedorDeSesion rutaDeRenovacion="/api/sesion/renovar" rutaDeIngreso="/ingreso">
      {children}
    </ProveedorDeSesion>
  );
}
