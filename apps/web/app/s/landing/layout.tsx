import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cssDeTema } from "../../../../../src/capacidades/experiencia/tema-css";
import { CabeceraDeMarca } from "../../../ui/componentes/CabeceraDeMarca";
import { EstiloDeMarca } from "../../../ui/componentes/EstiloDeMarca";
import "../../../ui/tokens.css";
import { exigirPuerta, nonceDelPedido, robotsDe } from "../../../servidor/pedido";

// Superficie LANDING (`pedernal.com.ar`): pública, sin sesión y sin cookies. Vuelve a resolver el host:
// si ya no es una landing, esto es la neutra.
export async function generateMetadata(): Promise<Metadata> {
  const puerta = await exigirPuerta("LANDING");
  return { title: puerta.marca.nombre, robots: robotsDe("LANDING") };
}

export default async function LayoutDeLanding({ children }: { children: ReactNode }) {
  const puerta = await exigirPuerta("LANDING");
  return (
    <>
      <EstiloDeMarca css={cssDeTema(puerta.marca.tema)} nonce={await nonceDelPedido()} />
      <CabeceraDeMarca nombre={puerta.marca.nombre} />
      {children}
    </>
  );
}
