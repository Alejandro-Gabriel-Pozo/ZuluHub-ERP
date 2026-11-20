import { NIVEL_POR_DEFECTO, type NivelDeControl } from "./nivel";

/**
 * Catálogo de controles (ADR-008). Es código, no base de datos: de acá sale el tipo cerrado
 * `ClaveDeControl`, así que un control mal escrito o sin catalogar no compila. Como las perillas, un
 * control que nadie verifica no se declara: cada módulo registra el suyo en el tramo que lo evalúa
 * (caja: `caja.cierre_con_diferencia`, `caja.cobro_en_jornada_vencida`;
 * stock: `stock.existencia_negativa`; reservas y facturación, los suyos). `caja.devolucion_supera_cobro` NO se declara nunca: devolver más de
 * lo cobrado es integridad del dinero, un bloqueo fijo del sistema, y un control solo puede ser `PERMITIR` o `AVISAR` (ADR-008 opción b). Cada módulo suma SUS claves en líneas separadas.
 *
 * La clave es `modulo.nombre_del_control`, con la forma que exige el CHECK `nivel_de_control_control_ck`
 * de la base: una clave que no la cumpla no podría guardar nunca su nivel (la prueba de este archivo la
 * exige a cada entrada).
 */
export type DefinicionDeControl = Readonly<{
  /** Qué vigila, en una línea (para quien lo configura y para la auditoría). */
  descripcion: string;
  /**
   * Nivel con el que nace el control cuando la empresa no configuró nada. Ausente = `PERMITIR` (ADR-008: todo nace en permitir).
   * Es una excepción declarada, no un valor por defecto nuevo: solo `AVISAR` tiene sentido acá (ningún control nace bloqueando).
   * Fuente: P-7 del dueño (18/11/2026: el sistema registra, advierte y etiqueta, no bloquea por un dato que falta) y la decisión de la
   * orquestadora del 18/11 para `caja.ingreso_sin_identificar`. Previene que el ingreso sin identificar nazca permitiendo en silencio
   * (`catalogo.test.ts`: solo ese control nace en `AVISAR`).
   */
  nivelDeNacimiento?: NivelDeControl;
}>;

export type CatalogoDeControles = Readonly<Record<string, DefinicionDeControl>>;

/** Misma forma que el CHECK `nivel_de_control_control_ck` (0007): minúsculas, un punto y guion bajo. */
export const FORMA_DE_CLAVE_DE_CONTROL = /^[a-z]+\.[a-z_]+$/;

export const CATALOGO_DE_CONTROLES = {
  // stock (E5-T5, D-E5-4): lo que mira una salida o la pata de origen de una transferencia que deja la existencia en negativo (D125).
  "stock.existencia_negativa": {
    descripcion: "Una salida o una transferencia que deja la existencia de un artículo en negativo",
  },
  // caja (PR-I1, tercero identificado; lo verifican PR-S2 y los PR del ingreso): un ingreso, un cobro o una salida de dinero sin nadie identificado.
  "caja.ingreso_sin_identificar": {
    descripcion: "Un ingreso de dinero sin ticket ni factura sin nadie identificado",
    nivelDeNacimiento: "AVISAR",
  },
  "ventas.cobro_de_ticket_sin_identificar": {
    descripcion: "El cobro de un ticket sin receptor y sin nadie identificado",
  },
  "caja.salida_sin_identificar": {
    descripcion: "Una salida de dinero sin compra sin decir quién la recibió",
  },
} as const satisfies CatalogoDeControles;

export type ClaveDeControl = keyof typeof CATALOGO_DE_CONTROLES;

/** El nivel con el que nace un control sin configuración de la empresa. Una clave que no está en el catálogo nace en `PERMITIR`. */
export function nivelDeNacimientoDe(control: string): NivelDeControl {
  const catalogo: CatalogoDeControles = CATALOGO_DE_CONTROLES;
  for (const [clave, definicion] of Object.entries(catalogo)) {
    if (clave === control) return definicion.nivelDeNacimiento ?? NIVEL_POR_DEFECTO;
  }
  return NIVEL_POR_DEFECTO;
}
