import { type CantidadConSigno } from "../../../primitivas/cantidad/con-signo";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";

/**
 * Los motivos de lo que queda de diferencia al aplicar un conteo (E5 conteo con hora, §3.2; decisión del dueño del 11 y 12/11/2026: lista cerrada del
 * sistema, motivo obligatorio y «otra» pide detalle). Es la copia en código de la tabla `motivo_de_diferencia` (0042, global, sembrada): una prueba de
 * integración las compara. NO son filas de `motivo_de_movimiento` (CF-D9): ese motivo es uno por movimiento y acá hay uno por artículo, y sumar
 * `VENTA_NO_REGISTRADA` allá la dejaría elegible en una salida manual. «Venta no registrada» solo mueve stock: no crea ticket, venta ni cobro.
 *
 * `FALTANTE`: contó menos de lo que el sistema creía (explican las salidas); `SOBRANTE`: contó más (explican las entradas). Puro.
 */
export type SentidoDeDiferencia = "FALTANTE" | "SOBRANTE";

export type MotivoDeDiferencia = Readonly<{
  codigo: string;
  sentido: SentidoDeDiferencia;
  /** «Otra salida» y «Otra entrada» exigen un detalle escrito. */
  pideDetalle: boolean;
  orden: number;
}>;

export const MOTIVOS_DE_DIFERENCIA: readonly MotivoDeDiferencia[] = [
  { codigo: "VENTA_NO_REGISTRADA", sentido: "FALTANTE", pideDetalle: false, orden: 1 },
  { codigo: "CONSUMO_INTERNO", sentido: "FALTANTE", pideDetalle: false, orden: 2 },
  { codigo: "MERMA", sentido: "FALTANTE", pideDetalle: false, orden: 3 },
  { codigo: "ROTURA", sentido: "FALTANTE", pideDetalle: false, orden: 4 },
  { codigo: "VENCIMIENTO", sentido: "FALTANTE", pideDetalle: false, orden: 5 },
  { codigo: "OTRA_SALIDA", sentido: "FALTANTE", pideDetalle: true, orden: 6 },
  { codigo: "DEVOLUCION_DE_CLIENTE", sentido: "SOBRANTE", pideDetalle: false, orden: 1 },
  { codigo: "OTRA_ENTRADA", sentido: "SOBRANTE", pideDetalle: true, orden: 2 },
];

/** El motivo que además exige poder ajustar stock (S-7): dar de baja por vencimiento es un ajuste, no solo contar. */
export const MOTIVO_QUE_EXIGE_AJUSTAR = "VENCIMIENTO";

export type ErrorDeMotivo = "MOTIVO_REQUERIDO" | "MOTIVO_NO_CORRESPONDE" | "DETALLE_REQUERIDO";

/** Faltante si la diferencia es negativa, sobrante si es positiva, `null` si es cero (no hay nada que explicar). */
export function sentidoDeLaDiferencia(diferencia: CantidadConSigno): SentidoDeDiferencia | null {
  if (diferencia.unidades < 0n) return "FALTANTE";
  return diferencia.unidades > 0n ? "SOBRANTE" : null;
}

/**
 * ¿La respuesta (motivo y detalle) es la que corresponde a esa diferencia final? Sin diferencia no se pregunta nada (ni motivo ni detalle); con
 * diferencia el motivo es obligatorio, de la lista y del sentido que corresponde, y «otra» exige detalle. Devuelve el motivo elegido (o `null`).
 */
export function validarMotivoDeDiferencia(
  diferenciaFinal: CantidadConSigno,
  motivo: string | null,
  detalle: string | null,
): Resultado<MotivoDeDiferencia | null, ErrorDeMotivo> {
  const sentido = sentidoDeLaDiferencia(diferenciaFinal);
  if (sentido === null) {
    return motivo === null && detalle === null ? ok(null) : err("MOTIVO_NO_CORRESPONDE");
  }
  if (motivo === null) return err("MOTIVO_REQUERIDO");
  const elegido = MOTIVOS_DE_DIFERENCIA.find((m) => m.codigo === motivo);
  if (elegido === undefined || elegido.sentido !== sentido) return err("MOTIVO_NO_CORRESPONDE");
  if (elegido.pideDetalle && detalle === null) return err("DETALLE_REQUERIDO");
  return ok(elegido);
}
