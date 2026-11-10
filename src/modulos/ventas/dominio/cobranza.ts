import { createHash } from "node:crypto";
import {
  importeATexto,
  importeCero,
  importeDesdeTexto,
  restar,
  sumar,
  type Importe,
} from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { EstadoDeTicket } from "./estados";
import { FORMA_DEL_IMPORTE } from "./forma-del-importe";
import { esUuid } from "./identificadores";

/**
 * LA COBRANZA DE UN TICKET (E4 §3.6), pura: qué cobros se piden, cómo se normalizan, si cuadran con el total al centavo, qué huella tienen y si el
 * ticket se puede cobrar. El dinero lo escribe caja; acá solo se decide. Sin reloj ni azar, sin `number` para dinero.
 * Códigos: `COBROS_INVALIDOS` (ninguno o más de 50), `IDENTIFICADOR_INVALIDO`, `MONEDA_NO_SOPORTADA`, `IMPORTE_INVALIDO` (no cumple la forma o es 0),
 * `COBRO_NO_CUADRA { falta | sobra }`, `TICKET_ANULADO`, `TICKET_NO_COBRABLE`, `TICKET_YA_COBRADO`, `EJEMPLAR_DESACTUALIZADO`.
 */
export const MAXIMO_DE_COBROS_POR_TICKET = 50;

export type CobroPedido = Readonly<{
  medioDePagoId: string;
  cuentaDeCobroId: string | null;
  /** Importe de la frontera: `{ moneda: "ARS", monto: "1234.56" }`. */
  importe: Readonly<{ moneda: string; monto: string }>;
}>;

export type CobroNormalizado = Readonly<{
  medioDePagoId: string;
  cuentaDeCobroId: string | null;
  importe: Importe;
}>;

export type ErrorDeCobros =
  "COBROS_INVALIDOS" | "IDENTIFICADOR_INVALIDO" | "MONEDA_NO_SOPORTADA" | "IMPORTE_INVALIDO";

const clave = (c: CobroNormalizado): string =>
  `${c.medioDePagoId}\u0000${c.cuentaDeCobroId ?? ""}\u0000${importeATexto(c.importe).padStart(20, "0")}`;

/**
 * Valida cada cobro y los deja en ORDEN CANÓNICO (por medio, cuenta e importe): el mismo pedido en otro orden es el mismo pedido y da la misma
 * huella y los mismos números de orden (1 a n). Se ordena la llave de texto con el orden por defecto, sin comparador propio.
 */
export function normalizarCobros(
  cobros: readonly CobroPedido[],
): Resultado<readonly CobroNormalizado[], ErrorDeCobros> {
  if (cobros.length === 0 || cobros.length > MAXIMO_DE_COBROS_POR_TICKET)
    return err("COBROS_INVALIDOS");
  const normalizados: CobroNormalizado[] = [];
  for (const c of cobros) {
    if (!esUuid(c.medioDePagoId) || (c.cuentaDeCobroId !== null && !esUuid(c.cuentaDeCobroId))) {
      return err("IDENTIFICADOR_INVALIDO");
    }
    if (c.importe.moneda !== ARS) return err("MONEDA_NO_SOPORTADA");
    if (!FORMA_DEL_IMPORTE.test(c.importe.monto)) return err("IMPORTE_INVALIDO");
    const importe = importeDesdeTexto(ARS, c.importe.monto);
    if (importe.unidades <= 0n) return err("IMPORTE_INVALIDO");
    normalizados.push({
      medioDePagoId: c.medioDePagoId,
      cuentaDeCobroId: c.cuentaDeCobroId,
      importe,
    });
  }
  const porLlave = new Map<string, CobroNormalizado[]>();
  for (const c of normalizados) porLlave.set(clave(c), [...(porLlave.get(clave(c)) ?? []), c]);
  return ok([...porLlave.keys()].sort().flatMap((k) => porLlave.get(k) as CobroNormalizado[]));
}

export type ErrorDeCuadre = Readonly<{ error: "COBRO_NO_CUADRA"; falta?: string; sobra?: string }>;

/** La suma de los cobros es el total del ticket AL CENTAVO: ni de menos (`falta`) ni de más (`sobra`; el vuelto no existe para el servidor, decisión 173). */
export function cuadrarCobros(
  total: Importe,
  cobros: readonly CobroNormalizado[],
): Resultado<null, ErrorDeCuadre> {
  const suma = cobros.reduce((a, c) => sumar(a, c.importe), importeCero(ARS));
  if (suma.unidades === total.unidades) return ok(null);
  if (suma.unidades < total.unidades) {
    return err({ error: "COBRO_NO_CUADRA", falta: importeATexto(restar(total, suma)) });
  }
  return err({ error: "COBRO_NO_CUADRA", sobra: importeATexto(restar(suma, total)) });
}

export type PedidoDeCobranza = Readonly<{
  ticketId: string;
  ejemplarId: string;
  cajaId: string;
  cobros: readonly CobroNormalizado[];
}>;

/** sha256 (hex) del pedido con los cobros ya en orden canónico: la misma clave con la misma huella devuelve lo hecho; con otra, `CLAVE_REUTILIZADA`. */
export function huellaDeCobranza(pedido: PedidoDeCobranza): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        pedido.ticketId,
        pedido.ejemplarId,
        pedido.cajaId,
        pedido.cobros.map((c) => [c.medioDePagoId, c.cuentaDeCobroId, importeATexto(c.importe)]),
      ]),
    )
    .digest("hex");
}

export type ErrorAlDecidirCobrar =
  "TICKET_ANULADO" | "TICKET_NO_COBRABLE" | "TICKET_YA_COBRADO" | "EJEMPLAR_DESACTUALIZADO";

/** Solo se cobra un ticket EMITIDO y el ejemplar que vio el cajero tiene que seguir siendo el vigente. Una cortesía (total 0) no se cobra. */
export function decidirCobrar(
  entrada: Readonly<{
    estadoDelTicket: EstadoDeTicket;
    ejemplarVigenteId: string;
    ejemplarId: string;
  }>,
): Resultado<null, ErrorAlDecidirCobrar> {
  if (entrada.estadoDelTicket === "ANULADO") return err("TICKET_ANULADO");
  if (entrada.estadoDelTicket === "COBRADO") return err("TICKET_YA_COBRADO");
  if (entrada.estadoDelTicket === "CORTESIA") return err("TICKET_NO_COBRABLE");
  return entrada.ejemplarId === entrada.ejemplarVigenteId
    ? ok(null)
    : err("EJEMPLAR_DESACTUALIZADO");
}

/** El total que el cajero vio tiene que ser el de ahora: si el precio cambió con el carrito armado, no se cobra nada (`PRECIO_CAMBIO`, S-7). */
export function decidirPrecioDeLaVenta(
  entrada: Readonly<{ totalActual: Importe; totalEsperado: Importe }>,
): Resultado<null, "PRECIO_CAMBIO"> {
  return entrada.totalActual.unidades === entrada.totalEsperado.unidades
    ? ok(null)
    : err("PRECIO_CAMBIO");
}
