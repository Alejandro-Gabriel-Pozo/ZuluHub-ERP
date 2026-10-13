/** Lectura defensiva de JSON que llega de afuera (el cuerpo de una respuesta de la librería de ingreso). */

export const esObjeto = (valor: unknown): valor is object =>
  typeof valor === "object" && valor !== null;

/** El JSON interpretado, o `null` si el texto no es JSON: nunca lanza. */
export function leerJson(texto: string): unknown {
  let datos: unknown = null;
  try {
    datos = JSON.parse(texto);
  } catch {
    // No es JSON: queda en null.
  }
  return datos;
}
