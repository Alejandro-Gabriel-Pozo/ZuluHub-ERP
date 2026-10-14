import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cssDeTema } from "../../../../../src/capacidades/experiencia/tema-css";
import { EstiloDeMarca } from "../../../ui/componentes/EstiloDeMarca";
import "../../../ui/tokens.css";
import { exigirPuerta, nonceDelPedido, robotsDe } from "../../../servidor/pedido";

// Superficie APP (`app.<dominio de la marca>`): privada, nunca se indexa. Vuelve a resolver el host. Pinta el tema
// de la marca; la cabecera con su nombre la ponen los grupos de rutas (la entrada tiene la suya y el mostrador la
// lleva dentro de su barra superior, para que haya un solo encabezado por pantalla).
export async function generateMetadata(): Promise<Metadata> {
  const puerta = await exigirPuerta("APP");
  return { title: puerta.marca.nombre, robots: robotsDe("APP") };
}

export default async function LayoutDeApp({ children }: { children: ReactNode }) {
  const puerta = await exigirPuerta("APP");
  return (
    <>
      <EstiloDeMarca css={cssDeTema(puerta.marca.tema)} nonce={await nonceDelPedido()} />
      {children}
    </>
  );
}
