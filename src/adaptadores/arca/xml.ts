import { XMLParser, XMLValidator } from "fast-xml-parser";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";

/**
 * Lectura y escritura de XML del adaptador de ARCA (spec H7 facturación §B.5.7, decisión 13 y D5). Valor
 * puro: sin red, sin reloj, sin azar.
 *
 * Lo que se LEE viene de un servicio externo y se trata como no confiable:
 *  - `processEntities: false`: no se expande ninguna entidad, ni las de un `DOCTYPE` (la «bomba» de entidades
 *    y la lectura de archivos por entidad externa son la categoría de fallo que previene);
 *  - además cualquier texto con `<!DOCTYPE` o `<!ENTITY` se rechaza ANTES de leerlo: ARCA no los manda;
 *  - `parseTagValue: false`: TODO es texto (y los atributos se ignoran). Un CAE que empieza con 0
 *    (`01234567890123`) o un importe (`121.50`) no pasan nunca por `number`: perderían el cero o los decimales;
 *  - el texto se valida como XML bien formado antes de leerse: el lector solo es tolerante con una etiqueta sin
 *    cerrar y devolvería una respuesta CORTADA a la mitad como si estuviera completa;
 *  - un nombre de etiqueta peligroso (`__proto__`) hace fallar al lector: es una respuesta ilegible.
 *
 * Lo que se ESCRIBE se arma con plantillas propias y cada valor de texto pasa por `escaparXml`.
 */

/** Un nodo leído: texto, un objeto con hijos o una lista cuando el elemento se repite. */
export type NodoXml = string | { readonly [nombre: string]: NodoXml } | readonly NodoXml[];

export type ErrorDeLectura = "XML_ILEGIBLE" | "XML_CON_DOCTYPE";

const lector = new XMLParser({
  processEntities: false,
  // Stryker disable next-line BooleanLiteral: con `processEntities` en false no tiene efecto; se declara por si el valor por defecto cambiara
  htmlEntities: false,
  parseTagValue: false,
  ignoreAttributes: true,
  removeNSPrefix: true,
  trimValues: true,
});

const DOCTYPE_O_ENTIDAD = /<!(?:DOCTYPE|ENTITY)/i;

/** El XML como un árbol de nodos sin espacios de nombres, o por qué no se pudo leer. */
export function leerXml(texto: string): Resultado<NodoXml, ErrorDeLectura> {
  if (DOCTYPE_O_ENTIDAD.test(texto)) return err("XML_CON_DOCTYPE");
  if (XMLValidator.validate(texto) !== true) return err("XML_ILEGIBLE");
  try {
    return ok(lector.parse(texto) as NodoXml);
  } catch {
    // El mensaje de la excepción no se propaga: podría repetir un pedazo de la respuesta.
    return err("XML_ILEGIBLE");
  }
}

/**
 * Baja por el camino de nombres (sin prefijo de espacio de nombres). `undefined` si en algún punto no hay
 * un objeto con ese hijo. Un elemento repetido en el camino se toma como ilegible: devuelve `undefined`.
 */
export function camino(
  nodo: NodoXml | undefined,
  ...nombres: readonly string[]
): NodoXml | undefined {
  let actual = nodo;
  for (const nombre of nombres) {
    if (typeof actual !== "object" || Array.isArray(actual)) return undefined;
    actual = (actual as { readonly [nombre: string]: NodoXml })[nombre];
  }
  return actual;
}

/** El texto de un nodo hoja (`""` para un elemento vacío), o `null` si no es un texto. */
export function textoDe(nodo: NodoXml | undefined): string | null {
  return typeof nodo === "string" ? nodo : null;
}

/** Un elemento que puede repetirse, siempre como lista: sin elemento son cero, con uno solo es una lista de uno. */
export function comoLista(nodo: NodoXml | undefined): readonly NodoXml[] {
  if (nodo === undefined) return [];
  return Array.isArray(nodo) ? (nodo as readonly NodoXml[]) : [nodo];
}

/**
 * TODOS los hijos de un elemento, cualquiera sea el nombre de su etiqueta (los repetidos incluidos). Las
 * tablas de `FEParamGet*` traen cada fila con su propio nombre (`CbteTipo`, `DocTipo`, `IvaTipo`,
 * `CondicionIvaReceptor`, `ConceptoTipo`, `Moneda`): buscar un nombre fijo las daba por vacías.
 */
export function hijosDe(nodo: NodoXml | undefined): readonly NodoXml[] {
  if (typeof nodo !== "object" || Array.isArray(nodo)) return [];
  return Object.values(nodo as { readonly [nombre: string]: NodoXml }).flatMap((hijo) =>
    comoLista(hijo),
  );
}

/** Escapa un valor de texto para ponerlo dentro de un elemento. */
export function escaparXml(valor: string): string {
  return valor
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** El carácter de una de las cinco entidades predefinidas de XML (el patrón ya las limita a esas). */
function caracterDeEntidad(nombre: string): string {
  switch (nombre) {
    case "lt":
      return "<";
    case "gt":
      return ">";
    case "amp":
      return "&";
    case "quot":
      return '"';
    default:
      return "'";
  }
}

/**
 * Deshace SOLO las cinco entidades predefinidas de XML, de una pasada (`&amp;lt;` queda `&lt;`, no `<`).
 * La respuesta de WSAA trae el `loginTicketResponse` como texto escapado dentro de `loginCmsReturn`. Una
 * entidad con nombre que no es de las cinco queda tal cual: no se resuelve nada que declare quien responde.
 */
export function desescaparXml(valor: string): string {
  return valor.replace(/&(lt|gt|amp|quot|apos);/g, (_entidad, nombre: string) =>
    caracterDeEntidad(nombre),
  );
}
