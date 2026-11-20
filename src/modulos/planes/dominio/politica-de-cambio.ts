import { sumarDiasCiviles, type FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { OrigenDeAsignacion } from "./asignacion";

/**
 * Política de cambio de plan (H-14a, dueño 18/11/2026): una para toda la plataforma, con tres números en días. Dominio puro: la fecha de
 * «hoy» (día civil de Argentina) entra como dato; no lee reloj ni azar.
 *
 * Previene: un cambio de plan que rige antes de lo que la plataforma decidió, y un arrepentimiento fuera de plazo, repetido o sobre un cambio
 * que no es el último. Chequeo: `politica-de-cambio.test.ts` (bordes de cada regla) y `test/integracion/politica-de-cambio-casos-de-uso.test.ts`.
 */

export type PoliticaDeCambioDePlan = Readonly<{
  version: number;
  diasDeAnticipacionDeSuba: number;
  diasDeAnticipacionDeBaja: number;
  diasDeArrepentimiento: number;
}>;

export type SentidoDelCambioDePlan = "SUBA" | "BAJA";

/**
 * Suba o baja a partir de la diferencia entre la versión que rige y la de destino (la calcula `diferenciaEntreVersiones`): es BAJA si el
 * destino quita algún módulo o baja alguna función o límite; si no, SUBA. Un cambio que sube unas cosas y baja otras es BAJA (S-1).
 */
export function sentidoDelCambio(
  diferencia: Readonly<{
    modulosQueSalen: readonly string[];
    perillas: readonly Readonly<{ sentido: "SUBE" | "BAJA" }>[];
  }>,
): SentidoDelCambioDePlan {
  return diferencia.modulosQueSalen.length > 0 ||
    diferencia.perillas.some((p) => p.sentido === "BAJA")
    ? "BAJA"
    : "SUBA";
}

function sumar(fecha: FechaCivil, dias: number): FechaCivil {
  const suma = sumarDiasCiviles(fecha, dias);
  // La política está acotada a un año y las fechas son de hoy: salir del calendario es un dato corrupto, no una entrada.
  if (!suma.ok)
    throw new RangeError(`la fecha ${fecha} más ${String(dias)} días sale del calendario`);
  return suma.valor;
}

/**
 * ¿La fecha pedida cumple la política? Suba: `vigenteDesde` ≥ hoy + anticipación de suba. Baja: ≥ hoy + el MAYOR entre la anticipación de baja y el
 * plazo de arrepentimiento (mientras dura el arrepentimiento de una baja el cliente sigue con el plan anterior). Si no cumple, devuelve la primera fecha
 * que sí. `arrepentimientoHasta` (inclusive) es hoy + plazo, o `null` con plazo 0. SUPUESTO (DEC-0777, brief §4.1.2): el día hoy + plazo la baja ya
 * rige y todavía se puede deshacer.
 */
export function decidirCondiciones(
  pedido: Readonly<{
    hoy: FechaCivil;
    vigenteDesde: FechaCivil;
    sentido: SentidoDelCambioDePlan;
    politica: PoliticaDeCambioDePlan;
  }>,
): Resultado<
  Readonly<{ arrepentimientoHasta: FechaCivil | null }>,
  Readonly<{ codigo: "ANTICIPACION_INSUFICIENTE"; primeraFechaValida: FechaCivil }>
> {
  const { politica } = pedido;
  const anticipacion =
    pedido.sentido === "SUBA"
      ? politica.diasDeAnticipacionDeSuba
      : Math.max(politica.diasDeAnticipacionDeBaja, politica.diasDeArrepentimiento);
  const primeraFechaValida = sumar(pedido.hoy, anticipacion);
  // Las fechas son `YYYY-MM-DD` de ancho fijo: el orden del texto es el orden del calendario.
  if (pedido.vigenteDesde < primeraFechaValida) {
    return err({ codigo: "ANTICIPACION_INSUFICIENTE", primeraFechaValida });
  }
  return ok({
    arrepentimientoHasta:
      politica.diasDeArrepentimiento === 0
        ? null
        : sumar(pedido.hoy, politica.diasDeArrepentimiento),
  });
}

export type ErrorDeArrepentimiento = Readonly<{
  codigo:
    "YA_ARREPENTIDO" | "NO_ES_EL_ULTIMO_CAMBIO" | "CAMBIO_SIN_ARREPENTIMIENTO" | "PLAZO_VENCIDO";
}>;

/**
 * ¿Se puede arrepentir este cambio hoy? Orden: ya arrepentido (un cambio se arrepiente una sola vez: lo primero que ve quien llega segundo),
 * no es el último cambio, sin arrepentimiento (no es de origen CAMBIO, nació sin condiciones o con plazo 0) y plazo vencido (el último día, inclusive,
 * todavía se puede).
 */
export function decidirArrepentimiento(
  pedido: Readonly<{
    hoy: FechaCivil;
    esElUltimo: boolean;
    origen: OrigenDeAsignacion;
    condiciones: Readonly<{ arrepentimientoHasta: FechaCivil | null }> | null;
    yaArrepentido: boolean;
  }>,
): Resultado<null, ErrorDeArrepentimiento> {
  if (pedido.yaArrepentido) return err({ codigo: "YA_ARREPENTIDO" });
  if (!pedido.esElUltimo) return err({ codigo: "NO_ES_EL_ULTIMO_CAMBIO" });
  const hasta = pedido.condiciones?.arrepentimientoHasta ?? null;
  if (pedido.origen !== "CAMBIO" || hasta === null) {
    return err({ codigo: "CAMBIO_SIN_ARREPENTIMIENTO" });
  }
  if (pedido.hoy > hasta) return err({ codigo: "PLAZO_VENCIDO" });
  return ok(null);
}
