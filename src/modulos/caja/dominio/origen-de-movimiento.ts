import { esUuid } from "./identificadores";

/**
 * El origen de un movimiento de efectivo que nace de otro módulo (compras, anticipo a rendir) y la clave de idempotencia que se deriva de él.
 * `movimiento_caja` no tiene columna de origen: el origen vive SOLO dentro de la clave `egreso_<tipo>_<id>` / `ingreso_<tipo>_<id>`, y la restricción única (empresa, clave) es lo que impide sacar o meter
 * la plata dos veces por el mismo origen. Puro: sin reloj ni azar.
 *
 * DEUDA R2 (hallazgo de `primitiva-de-libro-diseno.md` §9; plan LB-5b): sin columnas `origen_tipo`/`origen_id` (nullables, aditivas, migración 0072 que el dueño
 * todavía no numeró) el origen de un movimiento solo se ubica leyendo el texto de la clave. No bloquea: la idempotencia, la anulación y la auditoría (que sí
 * lleva `origenTipo`/`origenId`) salen de la clave derivada. revisarAntes: 2027-01-15 (fecha a confirmar por el orquestador: 60 días, el tope de una excepción del registro de deuda).
 *
 * Las listas son CERRADAS (lista blanca, fail-closed): un origen que no está acá no se registra. Sumar un origen es una línea acá y una decisión del dueño.
 * Previene: que un origen no pensado (o con el id mal escrito, otra empresa o en mayúsculas) abra un movimiento de caja con una clave que nadie vigila.
 */

/** Salen de la caja: el pago en efectivo de una factura de compras y la entrega de efectivo a rendir (anticipo al personal; solo gerente y administrador). */
export const ORIGENES_DE_EGRESO = ["PAGO_A_PROVEEDOR", "ENTREGA_A_RENDIR"] as const;
export type TipoDeOrigenDeEgreso = (typeof ORIGENES_DE_EGRESO)[number];

/** Entran a la caja: el reintegro en efectivo de un proveedor (N4-T4) y la devolución del sobrante de un anticipo. */
export const ORIGENES_DE_INGRESO = ["REINTEGRO_DE_PROVEEDOR", "DEVOLUCION_DE_SOBRANTE"] as const;
export type TipoDeOrigenDeIngreso = (typeof ORIGENES_DE_INGRESO)[number];

export type ErrorDeOrigen = "ORIGEN_INVALIDO";

/** Cómo empieza cada clave derivada. Son los únicos prefijos: las claves que manda una pantalla no pueden empezar así (`esClaveReservada`). */
export const PREFIJO_DE_CLAVE_DE_EGRESO = "egreso_";
export const PREFIJO_DE_CLAVE_DE_INGRESO = "ingreso_";
export const PREFIJO_DE_CLAVE_DE_ANULACION = "anulacion_";

const PREFIJOS_RESERVADOS = [
  PREFIJO_DE_CLAVE_DE_EGRESO,
  PREFIJO_DE_CLAVE_DE_INGRESO,
  PREFIJO_DE_CLAVE_DE_ANULACION,
] as const;

/**
 * `true`: la clave tiene la forma de una derivada de un origen. Las operaciones que mandan clave desde la pantalla (movimiento manual, ajuste, anulación,
 * apertura) la rechazan: el permiso `movimientos_caja.registrar_manual` alcanza al operador, y sin esto podría «ocupar» la clave de una entrega a rendir o de un
 * reintegro (que son de gerente y administrador) y hacer que esa operación fallara con `CLAVE_REUTILIZADA`.
 */
export function esClaveReservada(clave: string): boolean {
  return PREFIJOS_RESERVADOS.some((prefijo) => clave.startsWith(prefijo));
}

function esOrigenDe(
  origen: unknown,
  tipos: readonly string[],
): origen is Readonly<{ tipo: string; id: string }> {
  if (typeof origen !== "object" || origen === null) return false;
  const { tipo, id } = origen as Readonly<Record<string, unknown>>;
  return (tipos as readonly unknown[]).includes(tipo) && esUuid(id);
}

/** El origen es de la lista cerrada de egresos y su id es un `uuid`. */
export function origenDeEgresoValido(
  origen: unknown,
): origen is Readonly<{ tipo: TipoDeOrigenDeEgreso; id: string }> {
  return esOrigenDe(origen, ORIGENES_DE_EGRESO);
}

/** El origen es de la lista cerrada de ingresos y su id es un `uuid`. */
export function origenDeIngresoValido(
  origen: unknown,
): origen is Readonly<{ tipo: TipoDeOrigenDeIngreso; id: string }> {
  return esOrigenDe(origen, ORIGENES_DE_INGRESO);
}

/** La clave de un origen: el id en minúsculas, así el mismo `uuid` escrito de dos maneras es UNA sola clave (y no dos movimientos). */
function claveDe(prefijo: string, tipo: string, id: string): string {
  return `${prefijo}${tipo.toLowerCase()}_${id.toLowerCase()}`;
}

/** La clave del egreso de un origen: una por origen, así repetir la operación no saca la plata dos veces. */
export function claveDeEgresoDe(
  origen: Readonly<{ tipo: TipoDeOrigenDeEgreso; id: string }>,
): string {
  return claveDe(PREFIJO_DE_CLAVE_DE_EGRESO, origen.tipo, origen.id);
}

/** La clave del ingreso de un origen: una por origen, así repetir la operación no mete la plata dos veces. */
export function claveDeIngresoDe(
  origen: Readonly<{ tipo: TipoDeOrigenDeIngreso; id: string }>,
): string {
  return claveDe(PREFIJO_DE_CLAVE_DE_INGRESO, origen.tipo, origen.id);
}

/** La clave de la anulación de un movimiento por origen (otra clave: la tabla de movimientos tiene una sola clave única por empresa). */
export function claveDeAnulacionDeOrigen(claveDelMovimiento: string): string {
  return `${PREFIJO_DE_CLAVE_DE_ANULACION}${claveDelMovimiento}`;
}
