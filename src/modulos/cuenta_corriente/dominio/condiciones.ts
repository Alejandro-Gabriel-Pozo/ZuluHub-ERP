import { importeATexto, importeDesdeTexto, type Importe } from "../../../primitivas/dinero/importe";
import { FORMA_DEL_IMPORTE } from "../../../primitivas/dinero/forma-del-importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import { huellaDeCampos } from "../../../primitivas/libro/huella";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { motivoDeSuspensionDeCuentaDesdeTexto } from "../../../primitivas/texto/motivo-de-suspension-de-cuenta";

/**
 * Las condiciones de la cuenta corriente de un cliente (CC-1; brief PR-CC-1 §2): el plazo de pago, el límite de crédito y el estado de la ficha. Puro: sin
 * reloj ni azar (el caso de uso corre dentro de una transacción que el adaptador repite entera, y la huella tiene que dar lo mismo cada vez).
 *
 * El límite solo se GUARDA: lo hace cumplir CC-2 al cargar una venta a cuenta, con la aprobación de quien administra (no es un bloqueo duro). El plazo no
 * bloquea nada: marca «vencida» una deuda, no impide vender.
 */

/** SUPUESTO (DEC-1067) (CC-1, brief §2): el plazo se guarda como entero de días entre 1 y 365; la pantalla ofrecerá 30 y 60 (catálogo). Revertir es cambiar el catálogo, no la base. */
export const PLAZO_MINIMO_EN_DIAS = 1;
export const PLAZO_MAXIMO_EN_DIAS = 365;

export type EstadoDeCuenta = "HABILITADA" | "SUSPENDIDA";

export type CuentaDelCliente = Readonly<{
  id: string;
  parteId: string;
  plazoDias: number;
  limite: Importe;
  estado: EstadoDeCuenta;
  /** Solo una cuenta suspendida lleva motivo (lo impone `cuenta_cliente_suspension_ck`). */
  motivoDeSuspension: string | null;
  version: number;
}>;

export type ErrorDePlazo = "PLAZO_INVALIDO";
export type ErrorDeLimite = "LIMITE_INVALIDO";
export type ErrorDeMotivo = "MOTIVO_INVALIDO";

/** Lo que llega de la pantalla puede ser cualquier cosa: solo un entero dentro del rango es un plazo. */
export function plazoValido(plazo: unknown): Resultado<number, ErrorDePlazo> {
  // `Number.isInteger` ya rechaza todo lo que no es un número entero (texto, `null`, `bigint`, `NaN`, infinitos, fracciones).
  if (!Number.isInteger(plazo)) return err("PLAZO_INVALIDO");
  const dias = plazo as number;
  return dias >= PLAZO_MINIMO_EN_DIAS && dias <= PLAZO_MAXIMO_EN_DIAS
    ? ok(dias)
    : err("PLAZO_INVALIDO");
}

/**
 * El límite llega como texto decimal (ADR-006; nunca `number`): dígitos y hasta 2 decimales con punto, sin signo, de hasta 9 enteros, la misma regla de todo importe
 * que escribe quien vende o cobra (`FORMA_DEL_IMPORTE`). Cero es válido (toda venta a cuenta pediría aprobación). En pesos (`ARS`), única moneda de v1.
 */
export function limiteValido(texto: unknown): Resultado<Importe, ErrorDeLimite> {
  if (typeof texto !== "string" || !FORMA_DEL_IMPORTE.test(texto)) return err("LIMITE_INVALIDO");
  return ok(importeDesdeTexto(ARS, texto));
}

export function motivoValido(texto: unknown): Resultado<string, ErrorDeMotivo> {
  if (typeof texto !== "string") return err("MOTIVO_INVALIDO");
  const motivo = motivoDeSuspensionDeCuentaDesdeTexto(texto);
  return motivo.ok ? motivo : err("MOTIVO_INVALIDO");
}

/**
 * La huella de la HABILITACIÓN: sha256 del pedido ya validado y normalizado (el límite como texto canónico: `10` y `10.00` son el mismo pedido). Con la clave
 * decide si un reintento es el mismo pedido o una clave reutilizada. La persona y la hora no entran: no las manda quien pide.
 */
export function huellaDeHabilitacion(
  entrada: Readonly<{ parteId: string; plazoDias: number; limite: Importe }>,
): string {
  return huellaDeCampos([
    "cuenta_corriente.habilitar",
    entrada.parteId,
    entrada.plazoDias,
    entrada.limite.moneda,
    importeATexto(entrada.limite),
  ]);
}

/** Suspender una cuenta ya suspendida, o reactivar una ya habilitada, es repetir lo hecho: éxito sin escribir ni auditar (aunque la versión esperada sea vieja). */
export function decidirCambioDeEstado(
  actual: EstadoDeCuenta,
  pedido: EstadoDeCuenta,
): "CAMBIAR" | "YA_ESTABA" {
  return actual === pedido ? "YA_ESTABA" : "CAMBIAR";
}

/** Cambiar el plazo y el límite a lo que ya son es repetir lo hecho (`SIN_CAMBIOS`): lo vigente, sin escribir ni auditar y aunque la versión esperada sea vieja. */
export function decidirCambioDeCondiciones(
  actual: Readonly<{ plazoDias: number; limite: Importe }>,
  pedido: Readonly<{ plazoDias: number; limite: Importe }>,
): "CAMBIAR" | "SIN_CAMBIOS" {
  return actual.plazoDias === pedido.plazoDias && actual.limite.unidades === pedido.limite.unidades
    ? "SIN_CAMBIOS"
    : "CAMBIAR";
}
