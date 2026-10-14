import { XMLParser } from "fast-xml-parser";

/**
 * Lectura y escritura de XML del espía (F0). DESCARTABLE: no se integra al producto (h7 facturación §B.5.6).
 *
 * El lector es `fast-xml-parser` ≥ 5.11 (autorizado SOLO en esta rama) con:
 *  - `processEntities: false`: no expande entidades (ni las del DOCTYPE, vector de CVE-2026-25896), y además
 *    cualquier respuesta con `<!DOCTYPE` se rechaza antes de leerla;
 *  - `parseTagValue: false` y `parseAttributeValue: false`: TODO es texto. Un CAE que empieza con 0 o un importe
 *    como `121.50` no pasan nunca por `number` (lección de los SDK de terceros: el CAE perdía su cero).
 * Lo que se escribe se arma con plantillas propias y cada valor pasa por `escapar`.
 */

export class XmlInseguro extends Error {
  override name = "XmlInseguro";
}

const lector = new XMLParser({
  processEntities: false,
  htmlEntities: false,
  parseTagValue: false,
  parseAttributeValue: false,
  ignoreAttributes: true,
  removeNSPrefix: true,
  trimValues: true,
});

/** Un nodo leído: texto, un objeto con hijos, o una lista cuando el elemento se repite. */
export type Nodo = string | { [nombre: string]: Nodo } | Nodo[];

export function leerXml(texto: string): Nodo {
  if (/<!DOCTYPE/i.test(texto)) throw new XmlInseguro("la respuesta trae un DOCTYPE: se rechaza");
  if (/<!ENTITY/i.test(texto)) throw new XmlInseguro("la respuesta declara entidades: se rechaza");
  return lector.parse(texto) as Nodo;
}

/** El primer nodo con ese nombre (sin prefijo), buscando en profundidad. */
export function buscar(nodo: Nodo | undefined, nombre: string): Nodo | undefined {
  if (nodo === undefined || typeof nodo === "string") return undefined;
  if (Array.isArray(nodo)) {
    for (const hijo of nodo) {
      const r = buscar(hijo, nombre);
      if (r !== undefined) return r;
    }
    return undefined;
  }
  if (nombre in nodo) return nodo[nombre];
  for (const hijo of Object.values(nodo)) {
    const r = buscar(hijo, nombre);
    if (r !== undefined) return r;
  }
  return undefined;
}

/** Todos los nodos con ese nombre (los elementos repetidos vienen como lista). */
export function buscarTodos(nodo: Nodo | undefined, nombre: string): Nodo[] {
  const r = buscar(nodo, nombre);
  if (r === undefined) return [];
  return Array.isArray(r) ? r : [r];
}

/** El texto de un nodo hoja, o `null`. */
function texto(nodo: Nodo | undefined): string | null {
  if (typeof nodo === "string") return nodo;
  if (typeof nodo === "number" || typeof nodo === "boolean") return String(nodo);
  return null;
}

export const textoDe = (nodo: Nodo | undefined, nombre: string): string | null =>
  texto(buscar(nodo, nombre));

/** Escapa un valor para ponerlo dentro de un elemento o un atributo. */
export function escapar(valor: string): string {
  return valor
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/**
 * Deshace SOLO las cinco entidades predefinidas de XML (y las numéricas decimales y hexadecimales). Lo necesita la
 * respuesta de WSAA, que trae el `loginTicketResponse` como texto escapado dentro de `loginCmsReturn`. No resuelve
 * entidades con nombre declaradas en un DOCTYPE (no hay DOCTYPE: se rechaza antes).
 */
export function desescapar(valor: string): string {
  return valor.replace(/&(lt|gt|amp|quot|apos|#\d{1,7}|#x[0-9a-fA-F]{1,6});/g, (_m, e: string) => {
    switch (e) {
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "amp":
        return "&";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default: {
        const codigo = e.startsWith("#x") ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
        return String.fromCodePoint(codigo);
      }
    }
  });
}
