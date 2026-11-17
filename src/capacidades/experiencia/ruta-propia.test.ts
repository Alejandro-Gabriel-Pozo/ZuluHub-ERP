import { describe, expect, it } from "vitest";
import { caminoDeRutaPropia } from "./ruta-propia";

const esCaminoDeRutaPropia = (camino: string): boolean => caminoDeRutaPropia(camino) !== null;

describe("esCaminoDeRutaPropia: lo que pasa", () => {
  it.each([
    "/",
    "/empresa",
    "/ventas/nueva",
    "/informes/2026.10",
    "/v1.2/x",
    "/archivo.pdf",
    "/a/.oculto/b",
    "/a/b../c",
    "/a..b",
    "/..a",
    "/.well-known/x",
    "/a_b-c~d",
    "/ñ",
    "/Ñandú",
    "/ÀÖØöøÿ",
    "/a%20b",
    "/a%7e",
    "/%41",
    "/%C3%B1",
    "/configuracion-fiscal/certificado-de-arca/homologacion",
    "/facturacion/comprobantes/3f2a9c1e-7b4d-4e8a-9f10-2c5d6e7f8a90",
    "/Z",
    "/z",
    "/0",
    "/9",
  ])("%j", (camino) => {
    expect(esCaminoDeRutaPropia(camino)).toBe(true);
  });
});

describe("esCaminoDeRutaPropia: vectores de redirección abierta y de subida de nivel", () => {
  it.each([
    ["sin barra inicial", "panel"],
    ["vacío", ""],
    ["protocolo relativo", "//evil.com"],
    ["tres barras", "///"],
    ["barra y barra invertida", "/\\evil.com"],
    ["barra invertida adentro", "/a\\b"],
    ["barra codificada dos veces seguidas", "/%2f%2fevil.com"],
    ["barra codificada en mayúsculas", "/%2F%2Fevil.com"],
    ["una barra codificada después de la inicial", "/%2fevil.com/x"],
    ["barra codificada en el medio", "/a%2f%2fb"],
    ["barra invertida codificada", "/%5cevil.com"],
    ["barra invertida codificada en mayúsculas", "/%5Cevil.com"],
    ["tabulación", "/\t/evil.com"],
    ["salto de línea", "/\n/evil.com"],
    ["retorno de carro", "/\r/evil.com"],
    ["tabulación codificada", "/%09/evil.com"],
    ["salto de línea codificado", "/%0a/evil.com"],
    ["esquema sin barras", "https:evil.com"],
    ["esquema con barras", "https://evil.com"],
    ["javascript", "javascript:alert(1)"],
    ["javascript con barra", "/javascript:alert(1)"],
    ["barra completa Unicode", "/／evil.com"],
    ["barra de división", "/∕evil.com"],
    ["barra de fracción", "/⁄evil.com"],
    ["barra completa al comienzo", "／evil.com"],
    ["punto de un solo punto", "/․․/x"],
    ["punto completo", "/．．/x"],
    ["puntos suspensivos", "/…/x"],
    ["anulación de dirección", "/‮evil.com"],
    ["anulación de dirección codificada", "/%E2%80%AEevil.com"],
    ["invisible de ancho cero", "/a​b"],
    ["NUL", "/a\u0000b"],
    ["NUL codificado", "/a%00b"],
    ["DEL", "/a\u007fb"],
    ["DEL codificado", "/a%7fb"],
    ["control codificado", "/a%1fb"],
    ["doble codificación de la barra", "/%252f%252fevil.com"],
    ["doble codificación de un punto", "/a/%252e%252e/b"],
    ["porcentaje solo", "/a%"],
    ["codificación rota", "/a%zz"],
    ["codificación rota de varios bytes", "/%E0%A4%A"],
    ["bytes que no son UTF-8", "/%C0%AF"],
    ["barra y punto y barra", "/.//evil"],
    ["con arroba", "/@evil.com"],
    ["con arroba en el medio", "/a@evil.com"],
    ["con arroba codificada", "/%40evil.com"],
    ["credenciales", "/user:pass@evil.com"],
    ["con dos puntos", "/a:b"],
    ["con espacio", "/a b"],
    ["con consulta", "/a?x=1"],
    ["con fragmento", "/a#x"],
    ["consulta codificada", "/a%3fx=1"],
    ["fragmento codificado", "/a%23x"],
    ["sube de nivel", "/a/../b"],
    ["sube de nivel al final", "/a/.."],
    ["punto solo", "/a/./b"],
    ["punto solo al final", "/a/."],
    ["sube de nivel codificado", "/a/%2e%2e/b"],
    ["sube de nivel codificado en mayúsculas", "/a/%2E%2e/b"],
    ["punto codificado al comienzo", "/%2e/a"],
    ["otro alfabeto", "/а"],
    ["emoji", "/😀"],
    ["signo de multiplicar", "/a×b"],
    ["signo de dividir", "/a÷b"],
    ["coma", "/a,b"],
    ["punto y coma", "/a;b"],
    ["más", "/a+b"],
    ["más codificado", "/a%2bb"],
    ["comillas", "/a'b"],
    ["paréntesis", "/(a)"],
    ["corchetes", "/[a]"],
    ["llaves", "/{a}"],
    ["menor", "/a<b"],
    ["comilla invertida", "/a`b"],
    ["barra vertical", "/a|b"],
    ["circunflejo", "/a^b"],
    ["comillas dobles", '/a"b'],
    ["asterisco", "/a*b"],
    ["igual", "/a=b"],
    ["ampersand", "/a&b"],
    ["exclamación", "/a!b"],
    ["pesos", "/a$b"],
  ])("rechaza %s: %j", (_nombre, camino) => {
    expect(esCaminoDeRutaPropia(camino)).toBe(false);
  });
});

// Un caso por cada carácter del conjunto y cada borde de los rangos: si alguien ensancha o recorta el conjunto, una de estas falla.
describe("caminoDeRutaPropia: devuelve el camino decodificado", () => {
  it.each([
    ["/", "/"],
    ["/a/b", "/a/b"],
    ["/%41", "/A"],
    ["/a%20b", "/a b"],
    ["/%C3%B1", "/ñ"],
    ["/a%7e", "/a~"],
    ["/%73/app", "/s/app"],
  ])("%j da %j", (camino, esperado) => {
    expect(caminoDeRutaPropia(camino)).toBe(esperado);
  });
  it("no devuelve nada (null) si no es de una ruta propia", () => {
    expect(caminoDeRutaPropia("//a")).toBeNull();
    expect(caminoDeRutaPropia("/a%00")).toBeNull();
    expect(caminoDeRutaPropia("/%2f")).toBeNull();
  });
});

describe("esCaminoDeRutaPropia: los bordes del conjunto", () => {
  const permitidos = [
    "A",
    "Z",
    "a",
    "z",
    "0",
    "9",
    "À",
    "Ö",
    "Ø",
    "ö",
    "ø",
    "ÿ",
    "-",
    "_",
    ".",
    "~",
  ];
  const vecinos = [
    "@", // antes de A
    "[", // después de Z
    "`", // antes de a
    "{", // después de z
    "/", // (permitido, pero no como carácter de nombre: se prueba aparte)
    ":", // después de 9
    "×", // entre Ö y Ø
    "÷", // entre ö y ø
    "Ā", // después de ÿ
    "¿", // antes de À
  ];
  it.each(permitidos)("%s pasa en el crudo y en el decodificado", (c) => {
    expect(esCaminoDeRutaPropia(`/a${c}b`)).toBe(true);
    const codificado = [...new TextEncoder().encode(c)]
      .map((b) => `%${b.toString(16).padStart(2, "0")}`)
      .join("");
    expect(esCaminoDeRutaPropia(`/a${codificado}b`)).toBe(true);
  });
  it.each(vecinos.filter((c) => c !== "/"))("el vecino %j queda afuera", (c) => {
    expect(esCaminoDeRutaPropia(`/a${c}b`)).toBe(false);
  });
  it("el espacio solo pasa escrito %20, y el porcentaje solo para escribir un permitido", () => {
    expect(esCaminoDeRutaPropia("/a b")).toBe(false);
    expect(esCaminoDeRutaPropia("/a%20b")).toBe(true);
    expect(esCaminoDeRutaPropia("/a%25b")).toBe(false);
    expect(esCaminoDeRutaPropia("/a%2525b")).toBe(false);
  });
  it("el largo no se limita acá (lo limita quien la usa)", () => {
    expect(esCaminoDeRutaPropia(`/${"a".repeat(5000)}`)).toBe(true);
  });
  it("la barra inicial es obligatoria y solo una", () => {
    expect(esCaminoDeRutaPropia("a/b")).toBe(false);
    expect(esCaminoDeRutaPropia("/")).toBe(true);
    expect(esCaminoDeRutaPropia("/a/")).toBe(true);
    expect(esCaminoDeRutaPropia("/a//")).toBe(false);
  });
  it("tiene que estar anclado en los dos extremos", () => {
    expect(esCaminoDeRutaPropia("/a\n")).toBe(false);
    expect(esCaminoDeRutaPropia("\n/a")).toBe(false);
    expect(esCaminoDeRutaPropia("/a ")).toBe(false);
    expect(esCaminoDeRutaPropia("x/a")).toBe(false);
  });
});
