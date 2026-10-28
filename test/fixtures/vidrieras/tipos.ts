import type { ModeloDeVidriera } from "../../../src/capacidades/experiencia/vidriera/modelos";
import type { ProductoParaPrecios } from "../../../src/capacidades/experiencia/vidriera/precios";

/** Foto de un producto tal como la lee la carta pública. La dirección es de nuestro host, nunca la del proveedor. */
export type FotoDeEjemplo = Readonly<{
  /** Ruta propia del host de la carta (§5.7.3); en los ejemplos no apunta a un archivo real. */
  direccion: string;
  /** Texto alternativo que cargó el comerciante; `null` si no cargó (la pantalla arma «Foto de {nombre}»). */
  alt: string | null;
  ancho: number;
  alto: number;
  /** Solo `VISIBLE` se muestra y cuenta para el modelo efectivo (§5.7, C-10). */
  estado: "VISIBLE" | "OCULTA" | "ROTA";
}>;

/** Un producto de la carta: lo que lee la puerta pública, más los grupos con sus recargos como texto decimal. */
export type ProductoDeEjemplo = Readonly<{
  id: string;
  nombre: string;
  /** Descripción propia (0 a 300 caracteres); `null` si no tiene. */
  descripcion: string | null;
  agotado: boolean;
  foto: FotoDeEjemplo | null;
}> &
  ProductoParaPrecios;

type SeccionDeEjemplo = Readonly<{
  id: string;
  nombre: string;
  productos: readonly ProductoDeEjemplo[];
}>;

export type VidrieraDeEjemplo = Readonly<{
  id: string;
  /** Código de la dirección pública; texto de ejemplo, no un código real. */
  codigo: string;
  nombre: string;
  rubro: "CAFETERIA" | "PANADERIA" | "HOSTERIA" | "BARBERIA";
  /** Lo que eligió el gerente; `null` = nunca eligió. */
  modeloElegido: ModeloDeVidriera | null;
  /** Perillas del plan de la empresa de ejemplo, para probar `modeloEfectivo`. */
  perillasEncendidas: readonly string[];
  secciones: readonly SeccionDeEjemplo[];
}>;

/** Id de ejemplo con forma de UUID v4 y determinista: `espacio` distingue la clase de dato. */
export function idDeEjemplo(espacio: number, n: number): string {
  const sufijo = n.toString(16).padStart(12, "0");
  return `${espacio.toString(16).padStart(8, "0")}-0000-4000-8000-${sufijo}`;
}

/** Atajo para una opción: `recargo` en texto decimal con hasta 6 decimales. */
export function opcion(nombre: string, recargo = "0"): { nombre: string; recargo: string } {
  return { nombre, recargo };
}
