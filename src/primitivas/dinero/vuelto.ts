import {
  importeATexto,
  importeCero,
  importeDesdeTexto,
  restar,
  sumar,
  type Importe,
} from "./importe";
import { err, ok, type Resultado } from "../resultado/resultado";
import { FORMA_DEL_IMPORTE } from "./forma-del-importe";
import { MAXIMO_DE_COBROS_POR_TICKET } from "./limites-de-cobro";
import { ARS } from "./moneda";

/**
 * EL VUELTO (mostrador, K2), puro: es PRESENTACIÓN. Vive en `primitivas` porque la pantalla de cobro lo calcula en el navegador y la UI no puede importar `src/modulos`. Lo que el cliente entrega en efectivo y lo que queda en caja difieren en el vuelto; al servidor
 * se le manda siempre lo que queda (`netoEnEfectivo`), porque un sobrante sigue siendo `COBRO_NO_CUADRA { sobra }` (decisión 173): el vuelto nunca
 * se registra como un cobro de más. Dueño único de esta cuenta: la pantalla y quien arme el cobro la importan, nadie la repite.
 * Regla: solo hay vuelto si hay sobrante Y el efectivo entregado lo cubre entero; con tarjeta, transferencia, QR u otro nunca se paga de más
 * (ese sobrante queda en `sobra` y el servidor lo rechaza). Sin `number` para dinero: texto decimal con moneda, enteros exactos por dentro.
 * Códigos: `PAGOS_INVALIDOS` (ninguno o más de 50), `MONEDA_NO_SOPORTADA`, `IMPORTE_INVALIDO` (forma o cero en un pago; total mal escrito).
 */
/** El único tipo de medio que da vuelto. Es el valor `EFECTIVO` de `TIPOS_DE_MEDIO` (caja): `vuelto.test.ts` lo comprueba para que no se desfasen. */
export const TIPO_DE_MEDIO_CON_VUELTO = "EFECTIVO";

export type PagoParaVuelto = Readonly<{
  /** El tipo del medio (`TIPOS_DE_MEDIO` de caja). Solo `"EFECTIVO"` puede dar vuelto: el resto se paga justo. */
  tipo: string;
  /** Importe de la frontera: `{ moneda: "ARS", monto: "1234.56" }`; lo que el cliente entrega con ese medio. */
  importe: Readonly<{ moneda: string; monto: string }>;
}>;

export type EntradaDeVuelto = Readonly<{
  total: Readonly<{ moneda: string; monto: string }>;
  pagos: readonly PagoParaVuelto[];
}>;

export type Vuelto = Readonly<{
  /** Lo que todavía falta cobrar (0 si cubre). */
  falta: string;
  /** Sobrante que NO se resuelve con vuelto (0 si no hay o si el efectivo lo cubre): el servidor lo rechazaría. */
  sobra: string;
  /** Lo que se devuelve al cliente (0 si no hay sobrante cubrible con efectivo). */
  vuelto: string;
  /** Efectivo que queda en caja: lo entregado menos el vuelto. Es el importe de efectivo que se le manda al servidor. */
  netoEnEfectivo: string;
}>;

export type ErrorDeVuelto = "PAGOS_INVALIDOS" | "MONEDA_NO_SOPORTADA" | "IMPORTE_INVALIDO";

const entero = (
  dato: Readonly<{ moneda: string; monto: string }>,
): Resultado<Importe, ErrorDeVuelto> => {
  if (dato.moneda !== ARS) return err("MONEDA_NO_SOPORTADA");
  if (!FORMA_DEL_IMPORTE.test(dato.monto)) return err("IMPORTE_INVALIDO");
  return ok(importeDesdeTexto(ARS, dato.monto));
};

export function calcularVuelto(entrada: EntradaDeVuelto): Resultado<Vuelto, ErrorDeVuelto> {
  if (entrada.pagos.length === 0 || entrada.pagos.length > MAXIMO_DE_COBROS_POR_TICKET) {
    return err("PAGOS_INVALIDOS");
  }
  const total = entero(entrada.total);
  if (!total.ok) return total;
  let entregado = importeCero(ARS);
  let efectivo = importeCero(ARS);
  for (const pago of entrada.pagos) {
    const importe = entero(pago.importe);
    if (!importe.ok) return importe;
    if (importe.valor.unidades <= 0n) return err("IMPORTE_INVALIDO");
    entregado = sumar(entregado, importe.valor);
    if (pago.tipo === TIPO_DE_MEDIO_CON_VUELTO) efectivo = sumar(efectivo, importe.valor);
  }
  const cero = importeCero(ARS);
  // Stryker disable next-line EqualityOperator: con lo entregado igual al total, `<` y `<=` dan el mismo resultado (falta 0, sin sobra ni vuelto, neto = efectivo); el borde lo fija la prueba «exactamente igual al total».
  if (entregado.unidades <= total.valor.unidades) {
    return ok({
      falta: importeATexto(restar(total.valor, entregado)),
      sobra: importeATexto(cero),
      vuelto: importeATexto(cero),
      netoEnEfectivo: importeATexto(efectivo),
    });
  }
  const sobrante = restar(entregado, total.valor);
  const hayVuelto = efectivo.unidades >= sobrante.unidades;
  return ok({
    falta: importeATexto(cero),
    sobra: importeATexto(hayVuelto ? cero : sobrante),
    vuelto: importeATexto(hayVuelto ? sobrante : cero),
    netoEnEfectivo: importeATexto(hayVuelto ? restar(efectivo, sobrante) : efectivo),
  });
}
