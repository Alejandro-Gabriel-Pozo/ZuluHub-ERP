import type { DefinicionDePerilla, LimiteDePerilla } from "./perillas";

/**
 * El valor de una perilla (marcas y planes, §B.5.3). Lleva su `tipo` (etiqueta) para que un
 * interruptor y un límite no se confundan al llegar de un plan o de un ajuste: el valor que no
 * coincide con la definición de su perilla se rechaza (`esValorDeLaPerilla`).
 */
export type ValorDePerilla =
  | Readonly<{ tipo: "INTERRUPTOR"; encendida: boolean }>
  | Readonly<{ tipo: "LIMITE"; limite: LimiteDePerilla }>;

/** De dónde sale un valor efectivo: el estándar del catálogo, la versión del plan o un ajuste del cliente. */
export type OrigenDeValor = "BASE" | "PLAN" | "AJUSTE";

/** El valor con el que rige la perilla, y de dónde salió (para que «Plan y módulos» y soporte lo expliquen). */
export type ValorEfectivo = ValorDePerilla & Readonly<{ origen: OrigenDeValor }>;

/** El mayor límite que admite la base: `^(0|[1-9][0-9]{0,8}|ILIMITADO)$`. */
export const LIMITE_MAXIMO_DE_PERILLA = 999_999_999;

/** El estándar de una perilla, con su etiqueta. */
export function valorBaseDe(definicion: DefinicionDePerilla): ValorDePerilla {
  return definicion.tipo === "INTERRUPTOR"
    ? { tipo: "INTERRUPTOR", encendida: definicion.base.encendida }
    : { tipo: "LIMITE", limite: definicion.base.limite };
}

/** Un límite válido: `ILIMITADO` o un entero entre 0 y el máximo de la base. */
function esLimiteValido(limite: unknown): limite is LimiteDePerilla {
  if (limite === "ILIMITADO") return true;
  if (!Number.isInteger(limite)) return false;
  const entero = limite as number;
  return entero >= 0 && entero <= LIMITE_MAXIMO_DE_PERILLA;
}

/**
 * ¿Es `valor` un valor bien formado para una perilla de ese tipo? Un interruptor trae `encendida`
 * (booleano) y un límite trae `limite` (entero 0..999.999.999 o `ILIMITADO`); el `tipo` tiene que ser
 * el de la definición. Acepta `unknown` porque los valores llegan de datos (planes y ajustes), no del
 * compilador; no modifica nada.
 */
export function esValorDeLaPerilla(
  definicion: Pick<DefinicionDePerilla, "tipo">,
  valor: unknown,
): valor is ValorDePerilla {
  if (typeof valor !== "object" || valor === null) return false;
  const campos = valor as Readonly<Record<string, unknown>>;
  if (campos["tipo"] !== definicion.tipo) return false;
  return definicion.tipo === "INTERRUPTOR"
    ? typeof campos["encendida"] === "boolean"
    : esLimiteValido(campos["limite"]);
}

/** ¿La perilla está en uso? Un interruptor encendido, o un límite mayor que 0 (`ILIMITADO` incluido). */
export function estaEncendida(valor: ValorDePerilla): boolean {
  return valor.tipo === "INTERRUPTOR"
    ? valor.encendida
    : valor.limite === "ILIMITADO" || valor.limite > 0;
}

/** El mismo valor, apagado: interruptor apagado o límite 0. Conserva el resto (el origen). */
export function apagado<V extends ValorDePerilla>(valor: V): V {
  return valor.tipo === "INTERRUPTOR" ? { ...valor, encendida: false } : { ...valor, limite: 0 };
}
