import { err, ok, type Resultado } from "../resultado/resultado";

/** Minutos enteros entre dos instantes (los segundos sobrantes se descartan). Valor puro. */
export type ErrorDeMinutos = "INSTANTE_INVALIDO" | "RANGO_DE_INSTANTES_INVALIDO";

const MS_POR_MINUTO = 60_000;

export function minutosEntre(inicio: Date, fin: Date): Resultado<number, ErrorDeMinutos> {
  const desde = inicio.getTime();
  const hasta = fin.getTime();
  if (Number.isNaN(desde) || Number.isNaN(hasta)) return err("INSTANTE_INVALIDO");
  if (hasta < desde) return err("RANGO_DE_INSTANTES_INVALIDO");
  return ok(Math.floor((hasta - desde) / MS_POR_MINUTO));
}
