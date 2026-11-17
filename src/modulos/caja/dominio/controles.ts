import type { Severidad } from "../../cierre/publico";

/**
 * Los controles que caja entrega al cierre del día (e3b §4.2) y su severidad. Cada una es una CONSTANTE por control, sin migración
 * (decisión 167: impiden cerrar solo lo que impide contar o cerrar bien: las cajas sin cerrar; todo lo demás se reconoce o informa).
 * La clave es `modulo.control` en minúsculas y guion bajo (la forma que exige el punto de enganche de `cierre`; una prueba la valida con
 * `controlesDelAporte`). Previene: que cada control invente su severidad en su propio lugar, y que un hallazgo que no impide contar
 * bloquee el cierre (o al revés).
 */
export type DefinicionDeControl = Readonly<{ clave: string; severidad: Severidad }>;

export const CONTROLES_DE_CAJA = {
  /** Impide cerrar (también es el impedimento de iniciar la auditoría): hay dinero todavía sin contar. */
  SESIONES_SIN_CERRAR: { clave: "caja.sesiones_sin_cerrar", severidad: "BLOQUEA" },
  DIFERENCIA_DE_ARQUEO: { clave: "caja.diferencia_de_arqueo", severidad: "RECONOCIBLE" },
  CONCILIACION_POR_MEDIO: { clave: "caja.conciliacion_por_medio", severidad: "RECONOCIBLE" },
  COBRADO_CONTRA_TICKET: { clave: "caja.cobrado_contra_ticket", severidad: "RECONOCIBLE" },
  COBROS_CORREGIDOS: { clave: "caja.cobros_corregidos", severidad: "INFORMA" },
  AJUSTES_A_JORNADAS_CERRADAS: { clave: "caja.ajustes_a_jornadas_cerradas", severidad: "INFORMA" },
} as const satisfies Readonly<Record<string, DefinicionDeControl>>;
