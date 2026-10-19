import type { ReactNode } from "react";
import { texto } from "../../../../../../src/capacidades/vocabulario/vocabulario";
import { CabeceraDeMarca } from "../../../../ui/componentes/CabeceraDeMarca";
import { FranjaSinConexion } from "../../../../ui/patrones/FranjaSinConexion.cliente";
import { exigirPuerta } from "../../../../servidor/pedido";

// Ingreso, invitación y elegir empresa: una tarjeta centrada bajo la cabecera de la marca. La franja de «sin
// conexión» acompaña a todas (el envío incierto de la invitación depende de saberlo).
export default async function LayoutDeEntrada({ children }: { children: ReactNode }) {
  const puerta = await exigirPuerta("APP");
  return (
    <>
      <FranjaSinConexion texto={texto({}, "conexion.sin_conexion")} />
      <CabeceraDeMarca nombre={puerta.marca.nombre} />
      {children}
    </>
  );
}
