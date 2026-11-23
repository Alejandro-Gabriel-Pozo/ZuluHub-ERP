import { err, ok, type Resultado } from "../resultado/resultado";
import { diasEntre, fechaDeNumeroDeDia, numeroDeDia } from "./dias";
import type { FechaCivil } from "./fecha-civil";

/**
 * Noches de una estadía: el rango es `[entrada, salida)`. La noche de una fecha es la que empieza
 * ese día; el día de salida no se cuenta. Valores puros, fechas civiles sin zona.
 */
export type RangoDeNoches = Readonly<{ entrada: FechaCivil; salida: FechaCivil }>;

export type ErrorDeNoches = "RANGO_DE_NOCHES_INVALIDO";

/** Cantidad de noches; la salida debe ser posterior a la entrada (una estadía tiene al menos una). */
export function nochesEntre(
  entrada: FechaCivil,
  salida: FechaCivil,
): Resultado<number, ErrorDeNoches> {
  const noches = diasEntre(entrada, salida);
  return noches >= 1 ? ok(noches) : err("RANGO_DE_NOCHES_INVALIDO");
}

/** Las fechas civiles de cada noche, en orden: de la entrada hasta el día anterior a la salida. */
export function nochesDe(rango: RangoDeNoches): Resultado<FechaCivil[], ErrorDeNoches> {
  const cantidad = nochesEntre(rango.entrada, rango.salida);
  if (!cantidad.ok) return cantidad;
  const primera = numeroDeDia(rango.entrada);
  return ok(Array.from({ length: cantidad.valor }, (_, i) => fechaDeNumeroDeDia(primera + i)));
}
