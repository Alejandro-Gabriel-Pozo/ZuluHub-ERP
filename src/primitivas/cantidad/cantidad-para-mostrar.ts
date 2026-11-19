import { UNIDADES, type CodigoDeUnidad } from "../unidades/unidades";
import { err, ok, type Resultado } from "../resultado/resultado";
import { cantidadDesdeTexto, type Cantidad } from "./cantidad";
import { ErrorDeValor } from "./errores";

/**
 * LA CANTIDAD QUE VE EL CLIENTE (decisión 181 del 12/11; el dueño pidió «½» en el ticket impreso, respuestas 24 a 27, 27A). UNA sola regla para escribirla, en la
 * pantalla, en el ticket y en la comanda (el papel de cocina usa la variante ASCII). Por unidad: el entero y la fracción reducida («½», «¾», «⅜», «1 ½», «2»); la fracción es
 * una parte de la unidad de la medida elegida. Por peso, volumen y demás: el número con coma y la unidad («350 g»), sin fracciones.
 * Solo cantidades positivas y, si se da el paso congelado, múltiplo exacto de él. Un denominador que no sea 2, 4 u 8 no se muestra como fracción (un tercio no existe: decisión 181):
 * `CANTIDAD_NO_MOSTRABLE`. Con `fraccionEnAscii` la fracción sale con barra («1/2», «1 1/2», «3/8») por si un papel térmico no dibuja «½»; el valor por defecto es «½».
 * Puro: sin reloj, sin azar, sin `number` para la cantidad (enteros exactos de 4 decimales).
 * Previene: dos reglas de cantidad (una en pantalla, otra en el papel) que se desfasan, y una fracción inexistente impresa como si fuera exacta.
 */
export type ErrorDeCantidadParaMostrar = "CANTIDAD_NO_MOSTRABLE";

export type OpcionesDeCantidadParaMostrar = Readonly<{ fraccionEnAscii?: boolean }>;

/** La abreviatura de cada unidad; el `satisfies` exige una por cada unidad conocida (una nueva sin abreviatura no compila). */
const ABREVIATURA_DE_UNIDAD = {
  UNIDAD: "u",
  GRAMO: "g",
  KILOGRAMO: "kg",
  TONELADA: "t",
  MILILITRO: "ml",
  LITRO: "l",
  METRO_CUBICO: "m³",
  MILIMETRO: "mm",
  CENTIMETRO: "cm",
  METRO: "m",
  CENTIMETRO_CUADRADO: "cm²",
  METRO_CUADRADO: "m²",
  MINUTO: "min",
  HORA: "h",
} as const satisfies Record<CodigoDeUnidad, string>;

const ESCALA = 10_000n; // la cantidad tiene 4 decimales

/** Las ÚNICAS fracciones que se muestran: propias, reducidas, con denominador 2, 4 u 8 (decisión 181). Lo que no está acá no se muestra como fracción. */
const FRACCION_UNICODE: Readonly<Record<string, string>> = {
  "1/2": "½",
  "1/4": "¼",
  "3/4": "¾",
  "1/8": "⅛",
  "3/8": "⅜",
  "5/8": "⅝",
  "7/8": "⅞",
};

function mcd(a: bigint, b: bigint): bigint {
  return b === 0n ? a : mcd(b, a % b);
}

function leer(texto: string): Cantidad | null {
  try {
    return cantidadDesdeTexto(texto);
  } catch (error) {
    if (error instanceof ErrorDeValor) return null;
    throw error;
  }
}

export function cantidadParaMostrar(
  cantidad: string,
  datos: Readonly<{ unidadDeVenta: string; paso?: string | undefined }>,
  opciones: OpcionesDeCantidadParaMostrar = {},
): Resultado<string, ErrorDeCantidadParaMostrar> {
  const c = leer(cantidad);
  if (c === null || c.unidades <= 0n) return err("CANTIDAD_NO_MOSTRABLE");
  if (datos.paso !== undefined) {
    const paso = leer(datos.paso);
    if (paso === null || paso.unidades <= 0n || c.unidades % paso.unidades !== 0n) {
      return err("CANTIDAD_NO_MOSTRABLE");
    }
  }
  if (!Object.hasOwn(UNIDADES, datos.unidadDeVenta)) return err("CANTIDAD_NO_MOSTRABLE");
  const codigo = datos.unidadDeVenta as CodigoDeUnidad;
  const entera = c.unidades / ESCALA;
  const resto = c.unidades % ESCALA;
  if (codigo !== "UNIDAD") {
    const decimales = resto.toString().padStart(4, "0").replace(/0+$/, "");
    const numero = decimales === "" ? `${entera}` : `${entera},${decimales}`;
    return ok(`${numero} ${ABREVIATURA_DE_UNIDAD[codigo]}`);
  }
  if (resto === 0n) return ok(`${entera}`);
  const divisor = mcd(resto, ESCALA);
  const numerador = resto / divisor;
  const denominador = ESCALA / divisor;
  const barra = `${numerador}/${denominador}`;
  const unicode = FRACCION_UNICODE[barra];
  if (unicode === undefined) return err("CANTIDAD_NO_MOSTRABLE");
  const fraccion = opciones.fraccionEnAscii === true ? barra : unicode;
  return ok(entera === 0n ? fraccion : `${entera} ${fraccion}`);
}
