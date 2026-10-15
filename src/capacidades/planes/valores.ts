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

/** Un límite escrito como la base lo guarda: `0` o un entero sin ceros a la izquierda, de hasta nueve cifras. */
const LIMITE_EN_TEXTO = /^(0|[1-9][0-9]{0,8})$/;

/**
 * El valor de un ajuste de perilla tal como la base lo guarda (`ajuste_de_perilla.valor`, texto):
 *  - `DEL_PLAN` vuelve al valor del plan (vale para cualquier perilla);
 *  - un interruptor: `0` apagado, `1` encendido (cualquier otro texto no es un valor de interruptor);
 *  - un límite: `ILIMITADO` o un entero de `0` al máximo de la base (`LIMITE_MAXIMO_DE_PERILLA`).
 * Un texto que no es un valor de ese tipo da `null`: quien lee lo trata como «vuelve al plan» (falla
 * cerrado), igual que `derechosDeUso` con un valor de otro tipo. La base solo impone la forma del texto,
 * no si cuadra con la perilla (no conoce el catálogo); quien escribe lo valida contra su definición.
 */
export function valorDeAjuste(
  definicion: Pick<DefinicionDePerilla, "tipo">,
  texto: string,
): ValorDePerilla | "DEL_PLAN" | null {
  if (texto === "DEL_PLAN") return "DEL_PLAN";
  if (definicion.tipo === "INTERRUPTOR") {
    if (texto === "0") return { tipo: "INTERRUPTOR", encendida: false };
    return texto === "1" ? { tipo: "INTERRUPTOR", encendida: true } : null;
  }
  if (texto === "ILIMITADO") return { tipo: "LIMITE", limite: "ILIMITADO" };
  return LIMITE_EN_TEXTO.test(texto) ? { tipo: "LIMITE", limite: Number(texto) } : null;
}

/**
 * Lo inverso de `valorDeAjuste`: el texto con el que la base guarda el valor de un ajuste de perilla
 * (`ajuste_de_perilla.valor`). `DEL_PLAN` vuelve al plan; un interruptor es `0` o `1`; un límite es su
 * entero (sin ceros a la izquierda ni notación científica: el máximo de la base tiene nueve cifras) o
 * `ILIMITADO`. Para todo valor bien formado de la perilla, `valorDeAjuste(def, textoDeAjuste(v))` vuelve
 * a `v`: quien escribe y quien lee usan las dos mitades de la misma regla.
 */
export function textoDeAjuste(valor: ValorDePerilla | "DEL_PLAN"): string {
  if (valor === "DEL_PLAN") return "DEL_PLAN";
  if (valor.tipo === "INTERRUPTOR") return valor.encendida ? "1" : "0";
  return String(valor.limite);
}
