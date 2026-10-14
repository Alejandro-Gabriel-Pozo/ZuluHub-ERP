import { describe, expect, it } from "vitest";
import {
  camino,
  comoLista,
  desescaparXml,
  escaparXml,
  hijosDe,
  leerXml,
  textoDe,
  type NodoXml,
} from "./xml";

const leer = (texto: string): NodoXml => {
  const r = leerXml(texto);
  if (!r.ok) throw new Error(`no se pudo leer: ${r.error}`);
  return r.valor;
};

describe("leerXml: todo es texto", () => {
  it("un CAE que empieza con 0 queda como texto, con su cero", () => {
    expect(leer("<a><CAE>01234567890123</CAE></a>")).toEqual({ a: { CAE: "01234567890123" } });
  });

  it("un importe con decimales finales, un entero y un exponente quedan como texto", () => {
    expect(leer("<a><x>121.50</x><y>100</y><z>1E3</z><w>0x10</w></a>")).toEqual({
      a: { x: "121.50", y: "100", z: "1E3", w: "0x10" },
    });
  });

  it("un elemento vacío es el texto vacío, y uno con espacios, también", () => {
    expect(leer("<a><CAE /><b></b><c>   </c></a>")).toEqual({ a: { CAE: "", b: "", c: "" } });
  });

  it("recorta los espacios de los extremos del texto", () => {
    expect(leer("<a>  <b>  1  </b>  </a>")).toEqual({ a: { b: "1" } });
  });

  it("un elemento repetido es una lista y uno solo es un texto", () => {
    expect(leer("<a><b>1</b><b>2</b><c>3</c></a>")).toEqual({ a: { b: ["1", "2"], c: "3" } });
  });
});

describe("leerXml: espacios de nombres y atributos", () => {
  it("quita el prefijo del espacio de nombres de las etiquetas", () => {
    expect(leer('<s:a xmlns:s="urn:x"><s:b>1</s:b></s:a>')).toEqual({ a: { b: "1" } });
  });

  it("ignora los atributos: no entran al resultado", () => {
    expect(leer('<a x="1" y="2"><b z="3">4</b></a>')).toEqual({ a: { b: "4" } });
  });

  it("la declaración XML no aparece como un hijo con texto", () => {
    expect(leer('<?xml version="1.0" encoding="utf-8"?><a><b>1</b></a>')).toEqual({
      "?xml": "",
      a: { b: "1" },
    });
  });
});

describe("leerXml: entidades desactivadas, sin DOCTYPE", () => {
  it("no expande las entidades predefinidas: quedan como vienen", () => {
    expect(leer("<a>x &lt;y&gt; &amp; &quot;z&quot; &apos;w&apos;</a>")).toEqual({
      a: "x &lt;y&gt; &amp; &quot;z&quot; &apos;w&apos;",
    });
  });

  it("no expande las entidades numéricas ni las de HTML", () => {
    expect(leer("<a>&#65;&#x41;&copy;&nbsp;</a>")).toEqual({ a: "&#65;&#x41;&copy;&nbsp;" });
  });

  it("rechaza un DOCTYPE, aunque no declare nada", () => {
    expect(leerXml("<!DOCTYPE a><a>1</a>")).toEqual({ ok: false, error: "XML_CON_DOCTYPE" });
  });

  it("rechaza un DOCTYPE con entidades (la «bomba» de entidades), sin expandirlas", () => {
    const bomba =
      '<?xml version="1.0"?><!DOCTYPE a [<!ENTITY x "BOOM"><!ENTITY y "&x;&x;&x;">]><a>&y;</a>';
    expect(leerXml(bomba)).toEqual({ ok: false, error: "XML_CON_DOCTYPE" });
  });

  it("rechaza un DOCTYPE con una entidad externa", () => {
    const externa = '<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><a>&x;</a>';
    expect(leerXml(externa)).toEqual({ ok: false, error: "XML_CON_DOCTYPE" });
  });

  it("rechaza DOCTYPE y ENTITY aunque vengan en minúsculas", () => {
    expect(leerXml("<!doctype a><a/>")).toEqual({ ok: false, error: "XML_CON_DOCTYPE" });
    expect(leerXml('<a><!entity x "y"></a>')).toEqual({ ok: false, error: "XML_CON_DOCTYPE" });
  });

  it("rechaza una declaración de entidad suelta, con la misma causa", () => {
    expect(leerXml('<a><!ENTITY x "y"></a>')).toEqual({ ok: false, error: "XML_CON_DOCTYPE" });
  });
});

describe("leerXml: lo ilegible", () => {
  it("una respuesta cortada a la mitad no se lee como si estuviera completa", () => {
    expect(leerXml("<a><b>1</b>")).toEqual({ ok: false, error: "XML_ILEGIBLE" });
    expect(leerXml("<a><b>12")).toEqual({ ok: false, error: "XML_ILEGIBLE" });
  });

  it("un cierre que no corresponde, un texto que no es XML y el texto vacío son ilegibles", () => {
    expect(leerXml("<a><b>1</c></a>")).toEqual({ ok: false, error: "XML_ILEGIBLE" });
    expect(leerXml("hola")).toEqual({ ok: false, error: "XML_ILEGIBLE" });
    expect(leerXml("")).toEqual({ ok: false, error: "XML_ILEGIBLE" });
  });

  it("un nombre de etiqueta peligroso (__proto__) es ilegible y no contamina nada", () => {
    expect(leerXml("<a><__proto__><x>1</x></__proto__></a>")).toEqual({
      ok: false,
      error: "XML_ILEGIBLE",
    });
    expect(({} as { x?: string }).x).toBeUndefined();
  });
});

describe("camino y textoDe", () => {
  const nodo = leer("<a><b><c>1</c><d>2</d><d>3</d></b><e>x</e></a>");

  it("baja por los nombres de a uno", () => {
    expect(camino(nodo, "a", "b", "c")).toBe("1");
    expect(camino(nodo, "a", "e")).toBe("x");
    expect(camino(nodo)).toBe(nodo);
  });

  it("devuelve undefined si falta un nombre en algún punto", () => {
    expect(camino(nodo, "z")).toBeUndefined();
    expect(camino(nodo, "a", "z", "c")).toBeUndefined();
  });

  it("devuelve undefined si baja por un texto o por un elemento repetido", () => {
    expect(camino(nodo, "a", "e", "x")).toBeUndefined();
    expect(camino(nodo, "a", "b", "d", "x")).toBeUndefined();
  });

  it("el elemento repetido en sí mismo se devuelve como lista", () => {
    expect(camino(nodo, "a", "b", "d")).toEqual(["2", "3"]);
  });

  it("partir de nada da nada", () => {
    expect(camino(undefined, "a")).toBeUndefined();
  });

  it("textoDe devuelve el texto, incluso el vacío, y null para todo lo demás", () => {
    expect(textoDe("1")).toBe("1");
    expect(textoDe("")).toBe("");
    expect(textoDe({ a: "1" })).toBeNull();
    expect(textoDe(["1"])).toBeNull();
    expect(textoDe(undefined)).toBeNull();
  });
});

describe("comoLista y hijosDe", () => {
  it("comoLista: nada es una lista vacía; uno, una lista de uno; varios, la misma lista", () => {
    expect(comoLista(undefined)).toEqual([]);
    expect(comoLista("1")).toEqual(["1"]);
    expect(comoLista({ a: "1" })).toEqual([{ a: "1" }]);
    expect(comoLista(["1", "2"])).toEqual(["1", "2"]);
  });

  it("hijosDe: todos los hijos, cualquiera sea su nombre, con los repetidos aplanados", () => {
    const tabla = leer("<R><A><Id>1</Id></A><A><Id>2</Id></A><B><Id>3</Id></B></R>");
    expect(hijosDe(camino(tabla, "R"))).toEqual([{ Id: "1" }, { Id: "2" }, { Id: "3" }]);
  });

  it("hijosDe: un solo hijo es una lista de uno", () => {
    expect(hijosDe(camino(leer("<R><A><Id>1</Id></A></R>"), "R"))).toEqual([{ Id: "1" }]);
  });

  it("hijosDe: un texto, una lista o nada no tienen hijos", () => {
    expect(hijosDe("")).toEqual([]);
    expect(hijosDe("x")).toEqual([]);
    expect(hijosDe(["a", "b"])).toEqual([]);
    expect(hijosDe(undefined)).toEqual([]);
  });
});

describe("escaparXml y desescaparXml", () => {
  it("escapa los cinco caracteres", () => {
    expect(escaparXml("&")).toBe("&amp;");
    expect(escaparXml("<")).toBe("&lt;");
    expect(escaparXml(">")).toBe("&gt;");
    expect(escaparXml('"')).toBe("&quot;");
    expect(escaparXml("'")).toBe("&apos;");
  });

  it("escapa todas las apariciones y el ampersand una sola vez", () => {
    expect(escaparXml("a&b<c>d\"e'f&g")).toBe("a&amp;b&lt;c&gt;d&quot;e&apos;f&amp;g");
    expect(escaparXml("&lt;")).toBe("&amp;lt;");
  });

  it("un texto sin caracteres especiales no cambia", () => {
    expect(escaparXml("Factura 0001-00000014")).toBe("Factura 0001-00000014");
  });

  it("desescapa las cinco entidades predefinidas, todas las apariciones", () => {
    expect(desescaparXml("&lt;&gt;&amp;&quot;&apos;")).toBe("<>&\"'");
    expect(desescaparXml("&lt;a&gt; &lt;b&gt;")).toBe("<a> <b>");
  });

  it("desescapa de una sola pasada: no resuelve lo que quedó escapado", () => {
    expect(desescaparXml("&amp;lt;")).toBe("&lt;");
    expect(desescaparXml("&amp;amp;")).toBe("&amp;");
  });

  it("deja tal cual toda otra entidad: no resuelve nada que declare quien responde", () => {
    expect(desescaparXml("&nbsp;&#65;&#x41;&foo;&LT;")).toBe("&nbsp;&#65;&#x41;&foo;&LT;");
  });

  it("el ida y vuelta de escapar y desescapar devuelve el texto original", () => {
    const texto = `<token a="1">x & y 'z'</token>`;
    expect(desescaparXml(escaparXml(texto))).toBe(texto);
  });
});
