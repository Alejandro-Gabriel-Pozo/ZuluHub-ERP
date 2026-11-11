import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { leerCantidad, leerCantidadPositiva, textoDeCantidad } from "./decimal";

/**
 * Los saldos de una línea (E9 §3.3, `compras.md D-43`): lo asignado a una conciliación NUNCA supera lo recibido ni lo facturado. La base lo impone con
 * `UPDATE saldo … WHERE cantidad_asignada + :n <= cantidad_recibida` (y `<= cantidad_facturada`); esta decisión pura es la MISMA regla, para que
 * el dominio la pruebe y la prueba de integración compare las dos. Cantidades como texto decimal exacto.
 */
export type ErrorDeAsignacion =
  | "CANTIDAD_INVALIDA"
  | "CANTIDAD_ASIGNADA_EXCEDE_LO_RECIBIDO"
  | "CANTIDAD_ASIGNADA_EXCEDE_LO_FACTURADO";

export type EntradaDeAsignacion = Readonly<{
  recibida: string;
  /** `null` si se asigna solo contra lo recibido (la recepción todavía no tiene factura). */
  facturada: string | null;
  asignada: string;
  /** Lo que se quiere asignar ahora: mayor que cero. */
  cantidad: string;
}>;

/** Lo que todavía se puede asignar de una línea: `recibida − asignada` (texto decimal), o `null` si algún dato no es una cantidad. */
export function saldoDeLinea(recibida: string, asignada: string): string | null {
  const r = leerCantidad(recibida);
  const a = leerCantidad(asignada);
  if (r === null || a === null || a > r) return null;
  return textoDeCantidad(r - a);
}

/** La asignada nueva (texto decimal) si la asignación entra, o el motivo por el que no. Primero lo recibido, después lo facturado. */
export function decidirAsignacion(
  entrada: EntradaDeAsignacion,
): Resultado<string, ErrorDeAsignacion> {
  const recibida = leerCantidad(entrada.recibida);
  const asignada = leerCantidad(entrada.asignada);
  const cantidad = leerCantidadPositiva(entrada.cantidad);
  const facturada = entrada.facturada === null ? null : leerCantidad(entrada.facturada);
  if (
    recibida === null ||
    asignada === null ||
    cantidad === null ||
    (entrada.facturada !== null && facturada === null)
  ) {
    return err("CANTIDAD_INVALIDA");
  }
  const nueva = asignada + cantidad;
  if (nueva > recibida) return err("CANTIDAD_ASIGNADA_EXCEDE_LO_RECIBIDO");
  if (facturada !== null && nueva > facturada) return err("CANTIDAD_ASIGNADA_EXCEDE_LO_FACTURADO");
  return ok(textoDeCantidad(nueva));
}
