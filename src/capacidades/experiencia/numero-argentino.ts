/**
 * El número que se escribe en la web, con la convención argentina: coma decimal y punto de miles. Una sola regla para todos los
 * campos numéricos (importe, cantidad, porcentaje): lo único que cambia entre ellos son los decimales y los enteros que admite su
 * primitiva, que entran por parámetro y NO se repiten acá.
 *
 * Decisión 153 (dueño, 2026-11-08) y pedido del dueño del 2026-11-12: se escriben solo dígitos y una coma; el punto NO se puede escribir
 * (la tecla «.» no escribe nada, «Yo rechazaría "."», 2026-11-12) y los puntos de miles los pone el SISTEMA mientras se escribe (como
 * los guiones del CUIT). Lo pegado se acepta solo si cada punto separa miles bien (`1.234,56`, `1234,56`); `1234.56` y todo punto mal
 * puesto se rechaza y el campo no cambia. Previene: «el punto decimal leído como miles» de los prototipos (`15.50` = 1.550; un 10x en
 * silencio sobre dinero o stock). Chequeo: `numero-argentino.test.ts` y `importe-tipeado.test.ts`.
 *
 * Toda la política del punto (escrito y pegado) vive en este archivo: `escribirNumero` (el punto escrito se descarta, siempre) e
 * `interpretarNumeroPegado` (el punto pegado). Cambiarla es tocar esas dos funciones y sus pruebas.
 *
 * El valor que viaja al servidor es texto decimal con punto (`1234.5`), nunca un `number` (ADR-006); el formato es solo de pantalla.
 */

export type ReglaDeNumero = Readonly<{
  /** Decimales máximos que admite la primitiva del dato (0 = entero: no se admite la coma). */
  decimales: number;
  /** Dígitos máximos de la parte entera que admite la primitiva del dato. */
  enterosMaximos: number;
  /** Si el canónico se completa con ceros hasta `decimales` (`5` → `5.00`), como el dinero. */
  completarDecimales?: boolean;
}>;

export type NumeroEscrito = Readonly<{
  /** Lo que muestra el campo: miles con punto y coma decimal (`1.234,5`). Vacío si no hay nada. */
  texto: string;
  /** Texto decimal canónico (`1234.5`). Vacío si no hay nada. */
  canonico: string;
  /** Dónde queda el cursor dentro de `texto`. */
  cursor: number;
}>;

/** Por qué se rechaza un pegado. `PUNTO_MAL_PUESTO` es todo punto que no se puede leer sin adivinar (`1.250`, `1.2.3`). */
export type MotivoDePegadoRechazado = "PUNTO_MAL_PUESTO" | "DECIMALES_DE_MAS" | "FORMA_INVALIDA";

export type NumeroPegado =
  | Readonly<{ ok: true; texto: string; canonico: string; cursor: number }>
  | Readonly<{ ok: false; motivo: MotivoDePegadoRechazado }>;

const VACIO: NumeroEscrito = { texto: "", canonico: "", cursor: 0 };

/** `1234567` → `1.234.567`. */
function conMiles(digitos: string): string {
  return digitos.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Arma lo que se ve y el canónico a partir de la parte entera y la decimal ya limpias (solo dígitos). `null` = sin coma. */
function armar(enteraCruda: string, decimal: string | null, regla: ReglaDeNumero): NumeroEscrito {
  const entera = enteraCruda.replace(/^0+(?=\d)/, "").slice(0, regla.enterosMaximos) || "0";
  const fraccion = decimal === null ? null : decimal.slice(0, regla.decimales);
  const texto = fraccion === null ? conMiles(entera) : `${conMiles(entera)},${fraccion}`;
  let canonico = entera;
  if (regla.completarDecimales === true && regla.decimales > 0) {
    canonico = `${entera}.${(fraccion ?? "").padEnd(regla.decimales, "0")}`;
  } else if (fraccion !== null && fraccion !== "") {
    canonico = `${entera}.${fraccion}`;
  }
  return { texto, canonico, cursor: texto.length };
}

/** La posición en `texto` que deja delante `significativos` caracteres que no son punto de miles. */
function cursorDespuesDe(texto: string, significativos: number): number {
  if (significativos <= 0) return 0;
  let vistos = 0;
  for (let i = 0; i < texto.length; i++) {
    if (texto[i] !== ".") vistos++;
    if (vistos === significativos) return i + 1;
  }
  return texto.length;
}

/**
 * Lo que queda en el campo cuando la persona escribe o borra. `crudo` es el valor del campo tal como lo dejó el navegador (con los
 * puntos de miles que el sistema puso antes) y `cursorCrudo` dónde estaba el cursor.
 *  - Solo quedan dígitos y UNA coma (la segunda se ignora) con hasta `decimales` decimales (el de más se ignora al escribirlo).
 *  - Todo punto se descarta: el escrito a mano no entra y los de miles los vuelve a poner el sistema.
 *  - El cursor queda detrás de lo último escrito aunque se agreguen o quiten puntos; borrar un punto de miles no cambia el valor.
 */
export function escribirNumero(
  crudo: string,
  cursorCrudo: number,
  regla: ReglaDeNumero,
): NumeroEscrito {
  const tipeado = crudo;
  const antes = tipeado.slice(0, cursorCrudo);
  let coma = -1;
  let entera = "";
  let decimal = "";
  let significativosAntes = 0;
  for (let i = 0; i < tipeado.length; i++) {
    const c = tipeado[i] as string;
    let cuenta = false;
    if (c >= "0" && c <= "9") {
      if (coma === -1) entera += c;
      else if (decimal.length < regla.decimales) decimal += c;
      else continue;
      cuenta = true;
    } else if (c === "," && coma === -1 && regla.decimales > 0) {
      coma = i;
      cuenta = true;
    }
    if (cuenta && i < antes.length) significativosAntes++;
  }
  if (entera === "" && coma === -1) return VACIO;
  const armado = armar(entera, coma === -1 ? null : decimal, regla);
  // Una coma sin parte entera muestra un «0» que la persona no escribió: el cursor lo cuenta si ya pasó la coma.
  const ceroAgregado = entera === "" && significativosAntes > 0 ? 1 : 0;
  return { ...armado, cursor: cursorDespuesDe(armado.texto, significativosAntes + ceroAgregado) };
}

/** Parte entera pegada: cero, dígitos sin ceros a la izquierda, o con miles bien puestos (grupos de tres tras un primer grupo de 1 a 3). */
const ENTERA_PEGADA = /^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:\.\d{3})+)$/;

/**
 * Interpreta lo PEGADO sin adivinar (es dinero o stock: nunca un 10x en silencio): se acepta solo si cada punto separa miles bien
 * (grupos de tres dígitos antes de la coma) y no hay más decimales de los que admite la regla. `1234.56`, `1.5` o `1.2.3` se
 * rechazan (un punto sin coma que no separa miles); con más decimales, se rechaza y no se recorta; con letras, signo o espacios
 * adentro, también. Los espacios de los extremos se ignoran (SUPUESTO, DEC-0061: lo copiado suele traerlos).
 */
export function interpretarNumeroPegado(crudo: string, regla: ReglaDeNumero): NumeroPegado {
  const texto = crudo.trim();
  if (!/^[\d.,]+$/.test(texto)) return { ok: false, motivo: "FORMA_INVALIDA" };
  const partes = texto.split(",");
  if (partes.length > 2) return { ok: false, motivo: "FORMA_INVALIDA" };
  // `split` siempre entrega al menos un elemento y aquí no más de dos: la entera existe, la decimal puede faltar.
  const [entera, decimal] = partes as [string, string | undefined];
  if (!ENTERA_PEGADA.test(entera)) {
    return { ok: false, motivo: entera.includes(".") ? "PUNTO_MAL_PUESTO" : "FORMA_INVALIDA" };
  }
  const digitos = entera.replace(/\./g, "");
  if (digitos.length > regla.enterosMaximos) return { ok: false, motivo: "FORMA_INVALIDA" };
  if (decimal !== undefined) {
    if (decimal.includes(".")) return { ok: false, motivo: "PUNTO_MAL_PUESTO" };
    if (decimal === "") return { ok: false, motivo: "FORMA_INVALIDA" };
    if (decimal.length > regla.decimales) return { ok: false, motivo: "DECIMALES_DE_MAS" };
  }
  return { ok: true, ...armar(digitos, decimal ?? null, regla) };
}

/** El canónico (`1234.5`) con miles y coma (`1.234,5`), o `""` si no es un número que la regla admita. */
export function mostrarNumero(canonico: string, regla: ReglaDeNumero): string {
  const partes = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(canonico);
  if (partes === null) return "";
  const [, entera, decimal] = partes as unknown as [string, string, string | undefined];
  if (entera.length > regla.enterosMaximos) return "";
  if (decimal !== undefined && decimal.length > regla.decimales) return "";
  const completo =
    regla.completarDecimales === true && regla.decimales > 0
      ? (decimal ?? "").padEnd(regla.decimales, "0")
      : (decimal ?? null);
  return armar(entera, completo, regla).texto;
}

/** El canónico de lo que hay en un campo (lo que mostró `escribirNumero`): vacío si no hay nada. */
export function canonicoDe(texto: string, regla: ReglaDeNumero): string {
  return escribirNumero(texto, texto.length, regla).canonico;
}
