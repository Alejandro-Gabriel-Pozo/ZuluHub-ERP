import type { ReactNode } from "react";
import { Texto } from "../../primitivas/Texto";
import { PlantillaNeutra } from "../PlantillaNeutra";

export type PropsDePantallaDeEstado = Readonly<{
  titulo: string;
  /** El detalle, ya resuelto. */
  detalle?: string;
  /** Lo que se puede hacer (un enlace, un botón) o el patrón de error. */
  children?: ReactNode;
}>;

/**
 * Pantalla de un estado de la aplicación sin datos propios: no encontrado, mantenimiento, sin permiso.
 * Una tarjeta con título, el porqué y qué hacer ([01] §6.4). Sin marca escrita acá.
 */
export function PantallaDeEstado({ titulo, detalle, children }: PropsDePantallaDeEstado) {
  return (
    <PlantillaNeutra titulo={titulo}>
      {detalle === undefined ? null : <Texto>{detalle}</Texto>}
      {children}
    </PlantillaNeutra>
  );
}
