import { CATALOGO_DE_MODULOS } from "../../capacidades/modulos/catalogo";
import { esClaveDe } from "../../capacidades/modulos/activos";

/** Validaciones de lo que se lee de la base para decidir permisos, compartidas por la autorización de empresa y por «explicar por qué» de soporte: una sola regla, un solo lugar. Sin tablas ni SQL. */

/** Una lista de acciones leída de la base: un valor que no es una lista de textos es un dato roto y falla (no se trata como «sin permisos» en silencio). */
export function listaDeAcciones(valor: unknown, de: string): readonly string[] | null {
  if (valor === null) return null;
  if (!Array.isArray(valor) || !valor.every((accion) => typeof accion === "string")) {
    throw new RangeError(`las acciones de ${de} no son una lista de textos`);
  }
  return valor;
}

/**
 * Un nombre de módulo que llega de la base tiene que ser una clave del catálogo (`esClaveDe`): la base solo
 * valida la FORMA (`^[a-z][a-z0-9_]{1,39}$`), y un nombre que el catálogo no conoce (o que ni siquiera tiene
 * esa forma) es un dato roto, no un módulo que haya que ignorar en silencio. Como el rol desconocido, es una
 * falla: ningún actor opera con un plan o una activación que el código no sabe leer.
 */
export function validarNombresDeModulo(
  origen: string,
  nombres: readonly string[],
): readonly string[] {
  for (const nombre of nombres) {
    if (!esClaveDe(CATALOGO_DE_MODULOS, nombre)) {
      throw new RangeError(`módulo desconocido en la base (${origen}): ${nombre}`);
    }
  }
  return [...nombres].sort();
}
