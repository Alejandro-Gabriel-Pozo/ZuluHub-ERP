import { err, ok, type Resultado } from "../resultado/resultado";
import type { TerceroIdentificado } from "./tercero-identificado";

/**
 * Lo que el caso de uso ya sabe: el nivel del control para esta empresa y sucursal, y si el movimiento exime por su naturaleza.
 * Quién la calcula es el caso de uso de cada PR; acá solo la regla de qué falta.
 */
export type ExigenciaDeTercero = "NO_SE_EXIGE" | "SE_EXIGE";

export function terceroQueFalta(
  exigencia: ExigenciaDeTercero,
  tercero: TerceroIdentificado | null,
): Resultado<null, "TERCERO_REQUERIDO"> {
  return exigencia === "SE_EXIGE" && tercero === null ? err("TERCERO_REQUERIDO") : ok(null);
}

/** Qué tipos admite cada lado (lista cerrada). La entrada no admite `EMPLEADO`. */
export function tipoAdmitido(lado: "ENTRADA" | "SALIDA", tercero: TerceroIdentificado): boolean {
  if (tercero.tipo === "NOMBRE") return true;
  return lado === "SALIDA";
}
