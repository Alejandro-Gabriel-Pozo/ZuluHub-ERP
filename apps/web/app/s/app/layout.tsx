import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cssDeTema } from "../../../../../src/capacidades/experiencia/tema-css";
import { CabeceraDeMarca } from "../../../ui/componentes/CabeceraDeMarca";
import { EstiloDeMarca } from "../../../ui/componentes/EstiloDeMarca";
import "../../../ui/tokens.css";
import { exigirPuerta, nonceDelPedido, robotsDe } from "../../../servidor/pedido";

// Superficie APP (`app.<dominio de la marca>`): privada, nunca se indexa. Vuelve a resolver el host.
export async function generateMetadata(): Promise<Metadata> {
  const puerta = await exigirPuerta("APP");
  return { title: puerta.marca.nombre, robots: robotsDe("APP") };
}

export default async function LayoutDeApp({ children }: { children: ReactNode }) {
  const puerta = await exigirPuerta("APP");
  return (
    <>
      <EstiloDeMarca css={cssDeTema(puerta.marca.tema)} nonce={await nonceDelPedido()} />
      <CabeceraDeMarca nombre={puerta.marca.nombre} />
      {children}
    </>
  );
}
