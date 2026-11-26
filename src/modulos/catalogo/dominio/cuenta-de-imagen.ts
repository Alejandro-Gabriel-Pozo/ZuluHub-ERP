import { createHash } from "node:crypto";
import type { PersonaId } from "../../../primitivas/identificadores/marca";

/**
 * Una cuenta del proveedor de imágenes que la empresa DECLARÓ como suya (spec de la carta §5.7.2; migración 0102). Solo una cuenta ACTIVA habilita que un logo (y, más
 * adelante, una foto) se traiga de ella; retirarla no la borra: queda con quién, cuándo y por qué, y no vuelve a activarse (volver a declararla es una fila nueva).
 * Hasta 2 activas por empresa y la misma cuenta puede estar en varias empresas: lo impone la base (tope serializado y único parcial).
 */
export type EstadoDeCuentaDeImagen = "ACTIVA" | "RETIRADA";

export type CuentaDeImagenDeclarada = Readonly<{
  id: string;
  proveedor: "CLOUDINARY";
  cuenta: string;
  estado: EstadoDeCuentaDeImagen;
  declaradaPor: PersonaId;
  declaradaEn: Date;
  retiradaPor: PersonaId | null;
  retiradaEn: Date | null;
  motivoDeRetiro: string | null;
  version: number;
}>;

/** La clave que manda la aplicación por gesto (un clic de «Declarar»): la forma que la base exige en `cuenta_de_imagen_clave_ck`. */
export const FORMA_DE_LA_CLAVE_DE_CUENTA_DE_IMAGEN = /^[A-Za-z0-9_-]{16,128}$/;

/**
 * La huella de lo que pide una alta: sha256 (hex) de proveedor y cuenta. Con la clave decide si un reintento es el mismo gesto (misma huella: devuelve lo hecho) o una clave
 * reutilizada para otra cosa (`CLAVE_REUTILIZADA`). Pura: sin reloj ni azar. Previene: un clic doble que declara dos veces, o una clave pisada con otra cuenta.
 */
export function huellaDeCuentaDeImagen(proveedor: string, cuenta: string): string {
  return createHash("sha256")
    .update(JSON.stringify([proveedor, cuenta]))
    .digest("hex");
}
