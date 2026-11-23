import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import {
  claveDeNombre,
  nombreDeProductoDesdeTexto,
} from "../../../primitivas/texto/nombre-de-producto";

/**
 * Una FAMILIA de productos (A8, `familias-especificacion.md`): reúne productos que siguen siendo independientes. Funciones PURAS, sin base ni reloj: el nombre (la
 * MISMA regla que el nombre de un producto: una sola) y el tope de miembros (una sola cifra, que usan el alta, la ficha y la acción de precio).
 */

/** Cuántos productos caben en una familia y en una acción sobre toda la familia (punto B13 de MIG §12.23, aprobado por el dueño el 11/11/2026). */
export const MAXIMO_DE_MIEMBROS_DE_FAMILIA = 50;

export type NombreDeFamilia = Readonly<{ nombre: string; nombreClave: string }>;

/** El nombre de una familia, con su clave de comparación (sin mayúsculas), o `NOMBRE_DE_FAMILIA_INVALIDO`. */
export function nombreDeFamiliaDesdeTexto(
  texto: string,
): Resultado<NombreDeFamilia, "NOMBRE_DE_FAMILIA_INVALIDO"> {
  const nombre = nombreDeProductoDesdeTexto(texto);
  if (!nombre.ok) return err("NOMBRE_DE_FAMILIA_INVALIDO");
  return ok({ nombre: nombre.valor, nombreClave: claveDeNombre(nombre.valor) });
}

/** ¿Entra otro miembro? (la familia ya tiene `vigentes`). */
export const hayLugarEnLaFamilia = (vigentes: number): boolean =>
  Number.isInteger(vigentes) && vigentes >= 0 && vigentes < MAXIMO_DE_MIEMBROS_DE_FAMILIA;
