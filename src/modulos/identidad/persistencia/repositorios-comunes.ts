import { emailDesdeTexto, type Email } from "../../../primitivas/contacto/email";

/** Piezas compartidas por los repositorios de identidad (una regla, un lugar). */

export const FORMA_DE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un valor de la base que el CHECK correspondiente no deja pasar: si llega otro, algo se rompió. */
export function deLaLista<T extends string>(lista: readonly T[], valor: string, nombre: string): T {
  const encontrado = lista.find((v) => v === valor);
  if (encontrado === undefined) throw new RangeError(`${nombre} desconocido en la base: ${valor}`);
  return encontrado;
}

export function aEmail(texto: string): Email {
  const r = emailDesdeTexto(texto);
  if (!r.ok) throw new RangeError("email guardado inválido en la base");
  return r.valor;
}
