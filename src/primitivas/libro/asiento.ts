import type { Importe } from "../dinero/importe";
import type { CantidadConSigno } from "../cantidad/con-signo";

/**
 * Lo que comparte todo asiento de un libro (C1 a C8 de `primitiva-de-libro-diseno.md` §2.1). `M` es la medida del libro: un `Importe`
 * (dinero con moneda) o una `CantidadConSigno`; nunca `number` (ADR-006) y nunca las dos en el mismo libro. Los instantes y la fecha
 * de negocio viajan como texto (ISO y `AAAA-MM-DD`): esta pieza es pura y no lee el reloj.
 */
export type AsientoBase<M extends Importe | CantidadConSigno> = Readonly<{
  empresaId: string;
  clave: string;
  huella: string;
  origenTipo: string;
  origenId: string;
  origenOrden: number;
  magnitud: M;
  anulaA: string | null;
  registradoPor: string;
  hechoEn: string;
  fechaNegocio: string;
}>;
