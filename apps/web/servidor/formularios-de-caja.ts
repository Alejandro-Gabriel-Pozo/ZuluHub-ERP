import "server-only";
import { redirect } from "next/navigation";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import type { ResultadoDeAccion } from "./acciones";

/**
 * Lo que tienen en común las acciones de formulario de la configuración de caja (medios de pago, cuentas de cobro y cajas): leer un campo del formulario como texto
 * y terminar la acción, que o devuelve el error ya traducido o vuelve a la lista. Se extrajo cuando la segunda pantalla real lo necesitó (ADR-014).
 */

/** El valor de un campo del formulario como texto; lo que no es texto (un archivo) o falta, es vacío: lo rechaza el servidor. */
export const textoDe = (datos: FormData, nombre: string): string => {
  const valor = datos.get(nombre);
  return typeof valor === "string" ? valor : "";
};

/** Termina una acción de formulario: el error ya traducido, o vuelve a la lista (`redirect` corta la ejecución). */
export function aLaLista(respuesta: Respuesta<unknown>, lista: string): ResultadoDeAccion {
  if (!respuesta.ok) return { error: respuesta.error };
  redirect(lista);
}
