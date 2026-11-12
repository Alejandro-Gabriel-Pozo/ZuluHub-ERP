import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";

/**
 * La máquina de estados de una orden de producción (E6 §3.1): ABIERTA pasa a CERRADA o a CANCELADA; CERRADA pasa a ANULADA; nada más. Una
 * orden cancelada o anulada no cambia nunca. Puro. La base repite la regla (`orden_validar`, 0033). Previene cerrar una orden cancelada,
 * cancelar una cerrada (que ya movió stock) o anular una abierta (que no movió nada).
 */
export const ESTADOS_DE_ORDEN = ["ABIERTA", "CERRADA", "CANCELADA", "ANULADA"] as const;
export type EstadoDeOrden = (typeof ESTADOS_DE_ORDEN)[number];
export type AccionSobreOrden = "CERRAR" | "CANCELAR" | "ANULAR";

export const esEstadoDeOrden = (texto: string): texto is EstadoDeOrden =>
  (ESTADOS_DE_ORDEN as readonly string[]).includes(texto);

const DESTINO: Readonly<Record<AccionSobreOrden, EstadoDeOrden>> = {
  CERRAR: "CERRADA",
  CANCELAR: "CANCELADA",
  ANULAR: "ANULADA",
};
const PARTIDA: Readonly<Record<AccionSobreOrden, EstadoDeOrden>> = {
  CERRAR: "ABIERTA",
  CANCELAR: "ABIERTA",
  ANULAR: "CERRADA",
};

export type ErrorDeTransicion =
  "ORDEN_CANCELADA" | "ORDEN_ANULADA" | "ORDEN_YA_CERRADA" | "ORDEN_NO_CERRADA";

/** El estado al que pasa la orden con esa acción, o por qué no puede. Repetir la misma acción ya hecha NO es un error: lo decide `yaEstaba`. */
export function transicionar(
  estado: EstadoDeOrden,
  accion: AccionSobreOrden,
): Resultado<EstadoDeOrden, ErrorDeTransicion> {
  if (estado === PARTIDA[accion]) return ok(DESTINO[accion]);
  if (estado === "CANCELADA") return err("ORDEN_CANCELADA");
  if (estado === "ANULADA") return err("ORDEN_ANULADA");
  if (accion === "ANULAR") return err("ORDEN_NO_CERRADA");
  // Lo único que queda es una cerrada que se quiere cerrar o cancelar: ya movió stock.
  return err("ORDEN_YA_CERRADA");
}

/** ¿La orden ya está en el estado que la acción busca? (la repetición: devuelve lo hecho sin escribir ni auditar). */
export const yaEstaba = (estado: EstadoDeOrden, accion: AccionSobreOrden): boolean =>
  estado === DESTINO[accion];
