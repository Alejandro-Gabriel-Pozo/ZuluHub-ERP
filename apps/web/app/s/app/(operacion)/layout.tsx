import type { ReactNode } from "react";
import { exigirSesion } from "../../../../servidor/sesion";
import { ProveedorDeSesion } from "../../../../ui/patrones/ProveedorDeSesion.cliente";

// El mostrador: sin sesión de ESTE host, a ingresar (una cookie de otra marca o vencida no cuenta). El estado
// de la sesión (aviso «¿Seguís ahí?», sesión vencida sin perder lo tipeado y renovación de la cookie) envuelve
// todas sus pantallas. Next no vuelve a correr un layout al navegar entre páginas que lo comparten, así que
// CADA página repite la guarda (`pantallaDeOperacion`): esta es la de la primera carga.
export default async function LayoutDeOperacion({ children }: { children: ReactNode }) {
  await exigirSesion();
  return (
    <ProveedorDeSesion rutaDeRenovacion="/api/sesion/renovar" rutaDeIngreso="/ingreso">
      {children}
    </ProveedorDeSesion>
  );
}
