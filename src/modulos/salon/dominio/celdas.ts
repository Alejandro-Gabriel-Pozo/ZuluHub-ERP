import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import {
  COLUMNAS_DEL_SALON,
  FILAS_DEL_SALON,
  posicionDeMesa,
  type FormaDeMesa,
  type PosicionDeMesa,
  type TamanoDeMesa,
} from "./mesa";

/**
 * LAS CASILLAS QUE OCUPA UNA MESA (E7 §3.2 `mesa_celda`; tabla de `mesas.html:313`). Redonda y cuadrada: 2×2, 3×3, 4×4; larga: 3×2, 4×2, 5×2
 * (ancho × alto, en casillas). La base impide que dos mesas activas ocupen la misma casilla con una única; esto es la misma cuenta en el
 * dominio, para dar el error antes de escribir. Previene: dos mesas dibujadas una encima de otra, o una que se sale del plano.
 */
export type HuellaDeMesa = Readonly<{ ancho: number; alto: number }>;

const HUELLA_DE_LA_LARGA = {
  CHICA: { ancho: 3, alto: 2 },
  MEDIANA: { ancho: 4, alto: 2 },
  GRANDE: { ancho: 5, alto: 2 },
} as const satisfies Record<TamanoDeMesa, HuellaDeMesa>;

const HUELLA_DE_LA_CUADRADA = {
  CHICA: { ancho: 2, alto: 2 },
  MEDIANA: { ancho: 3, alto: 3 },
  GRANDE: { ancho: 4, alto: 4 },
} as const satisfies Record<TamanoDeMesa, HuellaDeMesa>;

export function huellaDeMesa(forma: FormaDeMesa, tamano: TamanoDeMesa): HuellaDeMesa {
  return forma === "LARGA" ? HUELLA_DE_LA_LARGA[tamano] : HUELLA_DE_LA_CUADRADA[tamano];
}

export type CasillaDeMesa = Readonly<{ columna: number; fila: number }>;

export type MesaEnElPlano = Readonly<{
  forma: FormaDeMesa;
  tamano: TamanoDeMesa;
  columna: number;
  fila: number;
}>;

/** Las casillas (columna, fila) que ocupa, por filas; `MESA_FUERA_DEL_SALON` si alguna cae fuera de 14 × 9. */
export function celdasDeMesa(
  mesa: MesaEnElPlano,
): Resultado<readonly CasillaDeMesa[], "MESA_FUERA_DEL_SALON"> {
  const esquina: Resultado<PosicionDeMesa, "MESA_FUERA_DEL_SALON"> = posicionDeMesa(mesa);
  if (!esquina.ok) return esquina;
  const { ancho, alto } = huellaDeMesa(mesa.forma, mesa.tamano);
  if (mesa.columna + ancho - 1 > COLUMNAS_DEL_SALON || mesa.fila + alto - 1 > FILAS_DEL_SALON) {
    return err("MESA_FUERA_DEL_SALON");
  }
  const celdas: CasillaDeMesa[] = [];
  for (let fila = mesa.fila; fila < mesa.fila + alto; fila++) {
    for (let columna = mesa.columna; columna < mesa.columna + ancho; columna++) {
      celdas.push({ columna, fila });
    }
  }
  return ok(celdas);
}

/** ¿Comparten alguna casilla? */
export function seSuperponen(a: readonly CasillaDeMesa[], b: readonly CasillaDeMesa[]): boolean {
  const ocupadas = new Set(a.map((c) => `${c.columna},${c.fila}`));
  return b.some((c) => ocupadas.has(`${c.columna},${c.fila}`));
}
