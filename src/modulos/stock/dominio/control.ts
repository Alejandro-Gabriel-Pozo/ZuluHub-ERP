import { sumarConSigno, type CantidadConSigno } from "../../../primitivas/cantidad/con-signo";
import type { ClaseDeMovimiento } from "./movimiento";

/**
 * El control de existencia negativa `stock.existencia_negativa` (E5 §3.1 disparador `renglon_aplicar`, D125): `PERMITIR` (por defecto),
 * `AVISAR` y `BLOQUEAR`. Solo mira las salidas y la pata de origen de una transferencia: los ajustes, los conteos y las anulaciones NUNCA
 * se bloquean (si no, un conteo que encuentra menos no se podría aplicar). Es la misma regla que el disparador de la base: una prueba de
 * integración fuerza los tres niveles por SQL. Puro.
 */
export const NIVELES_DE_EXISTENCIA_NEGATIVA = ["PERMITIR", "AVISAR", "BLOQUEAR"] as const;
export type NivelDeExistenciaNegativa = (typeof NIVELES_DE_EXISTENCIA_NEGATIVA)[number];

/**
 * El nivel que vale: sin fila en `nivel_de_control` es `PERMITIR` (D125); un valor que no es ninguno de los tres cierra (`BLOQUEAR`): ante
 * una duda el sistema cierra y nunca se habilita lo que nadie declaró.
 */
export function nivelDeExistenciaNegativa(guardado: string | null): NivelDeExistenciaNegativa {
  if (guardado === null) return "PERMITIR";
  return (NIVELES_DE_EXISTENCIA_NEGATIVA as readonly string[]).includes(guardado)
    ? (guardado as NivelDeExistenciaNegativa)
    : "BLOQUEAR";
}

export type RenglonAControlar = Readonly<{
  depositoId: string;
  articuloId: string;
  /** Con signo: la salida resta, la pata de origen de una transferencia resta. */
  cantidad: CantidadConSigno;
  /** La existencia del saldo ANTES de este renglón (con el saldo ya bloqueado). */
  existenciaActual: CantidadConSigno;
  /** El renglón trae la confirmación de la persona (`confirmo_negativo`). */
  confirmoNegativo: boolean;
}>;

export type Negativo = Readonly<{
  depositoId: string;
  articuloId: string;
  existenciaResultante: CantidadConSigno;
  confirmado: boolean;
}>;

/**
 * `PASA`: ningún renglón queda negativo (o la clase no se controla). `PASA_CON_EXCEPCION`: queda negativo y el nivel lo permite (o lo
 * confirmaron): el caso de uso audita cada excepción. `REQUIERE_CONFIRMACION` (`AVISAR` sin confirmar) y `BLOQUEA` (`BLOQUEAR`)
 * rechazan el movimiento entero y llevan el detalle de los saldos que quedarían negativos.
 */
export type DecisionDeNegativo = Readonly<{
  resultado: "PASA" | "PASA_CON_EXCEPCION" | "REQUIERE_CONFIRMACION" | "BLOQUEA";
  negativos: readonly Negativo[];
}>;

/** Un renglón se controla si resta en una salida o en una transferencia (en ésta, la pata de origen es la que resta). */
const seControla = (clase: ClaseDeMovimiento, cantidad: CantidadConSigno): boolean =>
  (clase === "SALIDA" || clase === "TRANSFERENCIA") && cantidad.unidades < 0n;

/**
 * Decide un movimiento contra el nivel vigente. `existenciaResultante` = existencia actual + cantidad del renglón; una suma que se sale
 * del rango de `numeric(18,4)` es un defecto (la base también la rechazaría): se lanza, no se traga (ADR-004).
 */
export function decidirExistenciaNegativa(
  nivel: NivelDeExistenciaNegativa,
  clase: ClaseDeMovimiento,
  renglones: readonly RenglonAControlar[],
): DecisionDeNegativo {
  const negativos: Negativo[] = [];
  for (const r of renglones) {
    if (!seControla(clase, r.cantidad)) continue;
    const suma = sumarConSigno(r.existenciaActual, r.cantidad);
    if (!suma.ok) throw new RangeError("stock: la existencia resultante se sale del rango");
    if (suma.valor.unidades >= 0n) continue;
    negativos.push({
      depositoId: r.depositoId,
      articuloId: r.articuloId,
      existenciaResultante: suma.valor,
      confirmado: r.confirmoNegativo,
    });
  }
  if (negativos.length === 0) return { resultado: "PASA", negativos };
  if (nivel === "BLOQUEAR") return { resultado: "BLOQUEA", negativos };
  if (nivel === "AVISAR" && !negativos.every((n) => n.confirmado)) {
    return { resultado: "REQUIERE_CONFIRMACION", negativos };
  }
  return { resultado: "PASA_CON_EXCEPCION", negativos };
}
