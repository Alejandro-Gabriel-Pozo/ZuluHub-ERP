import type { EmpresaId, PersonaId, SucursalId } from "../../../primitivas/identificadores/marca";
import type { CartaPublicaId, ProductoId } from "./identificadores";

/**
 * La carta pública y el botón «Ocultar» (carta real, §3.2 y §3.2b de `11-especificaciones/carta-real-especificacion.md`). Lo que el catálogo lee de la
 * base, ya traducido. Ninguno lleva dinero: la carta no guarda precios.
 */

/** «Retirar» una carta conserva su código: el QR impreso vuelve a andar al ponerla en línea otra vez. Nace `FUERA_DE_LINEA`. */
export type EstadoDeCarta = "EN_LINEA" | "FUERA_DE_LINEA";

/** La carta en línea de una sucursal (una por sucursal). El `codigo` es la llave pública del QR y no cambia nunca. */
export type CartaPublica = Readonly<{
  id: CartaPublicaId;
  empresaId: EmpresaId;
  sucursalId: SucursalId;
  codigo: string;
  nombre: string;
  rubro: string | null;
  lugar: string | null;
  estado: EstadoDeCarta;
  version: number;
}>;

/**
 * «Este producto está oculto (o se volvió a mostrar) en este alcance». `sucursalId` nulo = toda la empresa. Sin fila = visible. La fila no se borra:
 * volver a mostrar es `oculto = false`.
 */
export type Disponibilidad = Readonly<{
  empresaId: EmpresaId;
  productoId: ProductoId;
  sucursalId: SucursalId | null;
  oculto: boolean;
  actualizadoPor: PersonaId | null;
  actualizadoEn: Date;
  version: number;
}>;

/**
 * LA regla de lectura (§3.2b), una sola vez: un producto está oculto en el local S si hay una fila de la EMPRESA con `oculto` o una fila de S con `oculto`.
 * Un local no puede «mostrar» lo que la empresa oculta. Recibe las filas del producto (las de la empresa y las del local; las de OTROS locales no cuentan
 * aunque lleguen) y devuelve el alcance que lo oculta: `EMPRESA` gana sobre `SUCURSAL` (es el que impide mostrarlo desde el local), `null` si está visible.
 */
export function ocultoPor(
  filas: readonly Pick<Disponibilidad, "sucursalId" | "oculto">[],
  sucursal: SucursalId,
): "EMPRESA" | "SUCURSAL" | null {
  if (filas.some((f) => f.oculto && f.sucursalId === null)) return "EMPRESA";
  if (filas.some((f) => f.oculto && f.sucursalId === sucursal)) return "SUCURSAL";
  return null;
}
