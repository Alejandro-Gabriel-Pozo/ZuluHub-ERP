import { importeCero, restar, type Importe } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";

/**
 * Vive en `consultas/` y no en el dominio porque la única que la usa es la consulta, que por ADR-005 no importa el dominio de su módulo; es una cuenta pura con
 * importes (sin reloj ni azar) y una sola regla: CC-2 la pide por `publico.ts` en vez de repetirla.
 */
export type DisponibleDeLaCuenta = Readonly<{
  /** Lo que queda por vender a cuenta: límite menos saldo, nunca negativo. */
  disponible: Importe;
  /** `true` si el saldo supera el límite (el disponible se muestra en cero). */
  excedido: boolean;
}>;

/**
 * Disponible = límite − saldo, nunca negativo (brief §5): si el saldo excede el límite, el disponible es cero y la cuenta figura «excedida». El saldo es el del libro
 * (positivo = lo que el cliente debe; negativo = saldo a favor, que SÍ suma al disponible).
 */
export function disponibleDe(limite: Importe, saldo: Importe): DisponibleDeLaCuenta {
  const diferencia = restar(limite, saldo);
  return diferencia.unidades < 0n
    ? { disponible: importeCero(ARS), excedido: true }
    : { disponible: diferencia, excedido: false };
}
