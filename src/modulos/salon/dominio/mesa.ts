import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";

/**
 * FICHAS DEL DATO: LA MESA (E7 §3.2, decisión 128; prototipo `mesas.html`). Número de 1 a 99, forma, tamaño y posición en una cuadrícula de
 * 14 columnas × 9 filas. El estado NO se guarda: se deriva (`estado-de-mesa.ts`). Todo es una lista cerrada (denegar por defecto): lo que no
 * está declarado acá se rechaza con un código estable. La base repite estos rangos en sus CHECK. Puro: sin reloj ni azar.
 */
export const FORMAS_DE_MESA = ["REDONDA", "CUADRADA", "LARGA"] as const;
export type FormaDeMesa = (typeof FORMAS_DE_MESA)[number];

export const TAMANOS_DE_MESA = ["CHICA", "MEDIANA", "GRANDE"] as const;
export type TamanoDeMesa = (typeof TAMANOS_DE_MESA)[number];

export const NUMERO_MINIMO_DE_MESA = 1;
export const NUMERO_MAXIMO_DE_MESA = 99;
export const COLUMNAS_DEL_SALON = 14;
export const FILAS_DEL_SALON = 9;

export type ErrorDeMesa =
  "NUMERO_DE_MESA_INVALIDO" | "FORMA_INVALIDA" | "TAMANO_INVALIDO" | "MESA_FUERA_DEL_SALON";

const esEntero = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n);

/** Previene: una mesa «0» o «100», o un número con decimales, que la base rechazaría de todos modos. */
export function numeroDeMesa(numero: number): Resultado<number, "NUMERO_DE_MESA_INVALIDO"> {
  return esEntero(numero) && numero >= NUMERO_MINIMO_DE_MESA && numero <= NUMERO_MAXIMO_DE_MESA
    ? ok(numero)
    : err("NUMERO_DE_MESA_INVALIDO");
}

export function formaDeMesa(texto: string): Resultado<FormaDeMesa, "FORMA_INVALIDA"> {
  const forma = FORMAS_DE_MESA.find((f) => f === texto);
  return forma === undefined ? err("FORMA_INVALIDA") : ok(forma);
}

export function tamanoDeMesa(texto: string): Resultado<TamanoDeMesa, "TAMANO_INVALIDO"> {
  const tamano = TAMANOS_DE_MESA.find((t) => t === texto);
  return tamano === undefined ? err("TAMANO_INVALIDO") : ok(tamano);
}

export type PosicionDeMesa = Readonly<{ columna: number; fila: number }>;

/** La esquina de la mesa está dentro de la cuadrícula (la huella completa la comprueba `celdasDeMesa`). */
export function posicionDeMesa(
  posicion: PosicionDeMesa,
): Resultado<PosicionDeMesa, "MESA_FUERA_DEL_SALON"> {
  return esEntero(posicion.columna) &&
    esEntero(posicion.fila) &&
    posicion.columna >= 1 &&
    posicion.columna <= COLUMNAS_DEL_SALON &&
    posicion.fila >= 1 &&
    posicion.fila <= FILAS_DEL_SALON
    ? ok({ columna: posicion.columna, fila: posicion.fila })
    : err("MESA_FUERA_DEL_SALON");
}
