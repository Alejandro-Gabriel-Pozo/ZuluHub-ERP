import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

/**
 * Ubicación de las fallas (`ubicacion.cjs`, meta-invariante M3): los descriptores `donde`, la regla de
 * línea de cada código y el analizador de JSON que dice en qué línea está una clave, un elemento o el
 * error. Se prueba `crearUbicador` con textos armados a mano y con la línea esperada contada acá, a ojo:
 * nunca se calcula con el mismo código que se prueba.
 */

type Donde = { tipo: string; texto?: string; camino?: unknown[] };
type Hallazgo = Record<string, unknown>;
const require = createRequire(import.meta.url);
const { crearUbicador, enArchivo, enContrato, enJson, enTexto, REGLAS_DE_LINEA } =
  require("../../arquitectura/contratos/ubicacion.cjs") as {
    crearUbicador: (
      leer: (ruta: string) => Buffer | string | null,
    ) => (hallazgo: Hallazgo) => Hallazgo;
    enArchivo: () => Donde;
    enContrato: (id: string | null) => Donde;
    enJson: (...camino: unknown[]) => Donde;
    enTexto: (texto: string) => Donde;
    REGLAS_DE_LINEA: Record<string, string>;
  };

const ARCHIVO = "datos/a.json";

/** Ubica un hallazgo de `ARCHIVO` con ese contenido (`null` = el archivo no se puede leer). */
function lineaEn(contenido: Buffer | string | null, donde: Donde): unknown {
  const ubicar = crearUbicador((ruta) => (ruta === ARCHIVO ? contenido : null));
  return ubicar({ codigo: "x", archivo: ARCHIVO, donde })["linea"];
}
const enLinea = (texto: string, ...camino: unknown[]): unknown => lineaEn(texto, enJson(...camino));

describe("los descriptores de «dónde»", () => {
  it("cada uno trae su tipo y sus datos", () => {
    expect(enArchivo()).toEqual({ tipo: "archivo" });
    expect(enTexto('clase: "docs"')).toEqual({ tipo: "texto", texto: 'clase: "docs"' });
    expect(enJson()).toEqual({ tipo: "json", camino: [] });
    expect(enJson("usa", 0)).toEqual({ tipo: "json", camino: ["usa", 0] });
  });

  it('la regla (d): la línea de `id: "<id>"`, o el archivo entero sin id', () => {
    expect(enContrato("color-separador")).toEqual({
      tipo: "texto",
      texto: 'id: "color-separador"',
    });
    expect(enContrato(null)).toEqual({ tipo: "archivo" });
  });
});

describe("la regla de línea de cada código de falla", () => {
  it("es esta, código por código (es lo que el informe muestra como «reglas ejecutadas»)", () => {
    expect(REGLAS_DE_LINEA).toEqual({
      "sin-rutas":
        "(e) clasificacion.cjs: línea de la tabla `const NIVELES` (1 si no se puede leer)",
      "regla-de-clasificacion-invalida":
        '(e) clasificacion.cjs: línea de la regla ofensora (`clase: "…"` o `glob: "…"`), 1 si no está',
      "ruta-sin-clase": "(c) la ruta, línea 1",
      "clasificacion-ambigua": "(c) la ruta, línea 1",
      "codigo-en-clase-excluida": "(c) la ruta, línea 1",
      "clase-sin-rutas":
        '(e) clasificacion.cjs: línea de la primera regla `clase: "<clase>"`, 1 si no está',
      "registro-invalido": '(d) contratos.cjs: línea de `id: "<id>"` del contrato, 1 si no está',
      "unidad-sin-declaracion": "(b) el contratos.json que falta, línea 1",
      "declaracion-invalida":
        "(a) contratos.json: línea de la clave ofensora (usa, noUsa, un campo sobrante) o del objeto si falta; JSON inválido: línea del error",
      "declara-contrato-inexistente": '(a) contratos.json: línea del id dentro de "usa"',
      "uso-sin-declarar": "(f) línea real del uso en el código",
      "no-usa-falso": "(f) línea real del uso en el código",
      "declaracion-falsa": '(a) contratos.json: línea del id dentro de "usa"',
      "definicion-fuera-de-la-fuente": "(f) línea real de la definición en el código",
      "contrato-sin-fuente":
        "(b) el archivo de la fuente de verdad (el que hay que crear o completar), línea 1",
      "ruta-ilegible": "(c) la ruta, línea 1",
      "detector-invalido":
        '(d) contratos.cjs: línea de `id: "<id>"` del contrato dueño del detector',
      "detector-sin-rutas":
        '(d) contratos.cjs: línea de `id: "<id>"` del contrato dueño del detector',
      "detector-en-clase-excluida":
        '(d) contratos.cjs: línea de `id: "<id>"` del contrato dueño del detector',
      "excepcion-invalida":
        "(a) excepciones.json / exclusiones.json: línea de la clave ofensora o del objeto si el campo falta; JSON inválido: línea del error",
      "excepcion-vencida": '(a) excepciones.json / exclusiones.json: línea de "vence"',
      "excepcion-plazo-excesivo": '(a) excepciones.json / exclusiones.json: línea de "vence"',
      "excepcion-vence-antes-de-creada":
        '(a) excepciones.json / exclusiones.json: línea de "vence"',
      "excepcion-creada-futura": '(a) excepciones.json / exclusiones.json: línea de "creada"',
      "excepcion-ruta-no-exacta": '(a) excepciones.json / exclusiones.json: línea de "ruta"',
      "excepcion-huella-cambiada": '(a) excepciones.json / exclusiones.json: línea de "huella"',
      "excepcion-obsoleta": '(a) excepciones.json / exclusiones.json: línea del "id" de la entrada',
      "excepcion-contrato-inexistente": '(a) excepciones.json: línea de "contrato"',
      "evasion-invalida":
        "(a) evasiones.json: línea de la clave ofensora o de la entrada si falta; JSON inválido: línea del error",
      "brecha-plazo-excesivo": '(a) evasiones.json: línea de "vence"',
      "brecha-vencida": '(a) evasiones.json: línea de "vence"',
      "riesgo-plazo-excesivo": '(a) evasiones.json: línea de "revisar"',
      "riesgo-vencido": '(a) evasiones.json: línea de "revisar"',
      "evasion-no-bloqueada": '(a) evasiones.json: línea de "estado" del caso',
      "brecha-cerrada": '(a) evasiones.json: línea de "estado" del caso',
      "riesgo-cerrado": '(a) evasiones.json: línea de "estado" del caso',
      "falla-sin-ubicacion": "guardian.cjs (o el archivo ofensor si lo trae), línea 1",
      "codigo-fuera-de-la-lista": "guardian.cjs (o el archivo ofensor si lo trae), línea 1",
    });
  });

  it("la tabla está congelada: nadie la cambia en caliente", () => {
    expect(Object.isFrozen(REGLAS_DE_LINEA)).toBe(true);
  });
});

describe("el ubicador completa la línea de un hallazgo", () => {
  it("un hallazgo que ya trae línea la conserva, sin tocar el disco, y pierde el descriptor", () => {
    const leidos: string[] = [];
    const ubicar = crearUbicador((ruta) => {
      leidos.push(ruta);
      return "x";
    });
    const resultado = ubicar({ codigo: "c", archivo: ARCHIVO, linea: 7, donde: enTexto("x") });
    expect(resultado).toStrictEqual({ codigo: "c", archivo: ARCHIVO, linea: 7 });
    expect(leidos).toEqual([]);
  });

  it("un hallazgo sin archivo de texto sigue sin línea (no se inventa una) y sin descriptor", () => {
    const ubicar = crearUbicador(() => "x");
    expect(ubicar({ codigo: "c", donde: enArchivo() })).toStrictEqual({ codigo: "c" });
    expect(ubicar({ codigo: "c", archivo: 7, donde: enArchivo() })).toStrictEqual({
      codigo: "c",
      archivo: 7,
    });
  });

  it("un hallazgo sin descriptor, o con uno desconocido, queda sin línea (y sin la propiedad)", () => {
    const ubicar = crearUbicador(() => "x");
    expect(ubicar({ codigo: "c", archivo: ARCHIVO })).toStrictEqual({
      codigo: "c",
      archivo: ARCHIVO,
    });
    expect(ubicar({ codigo: "c", archivo: ARCHIVO, donde: { tipo: "raro" } })).toStrictEqual({
      codigo: "c",
      archivo: ARCHIVO,
    });
  });

  it("«archivo»: línea 1, sin leer nada", () => {
    const leidos: string[] = [];
    const ubicar = crearUbicador((ruta) => {
      leidos.push(ruta);
      return null;
    });
    expect(ubicar({ codigo: "c", archivo: ARCHIVO, donde: enArchivo() })["linea"]).toBe(1);
    expect(leidos).toEqual([]);
  });

  it("lee cada archivo una sola vez aunque se ubiquen varios hallazgos", () => {
    const leidos: string[] = [];
    const ubicar = crearUbicador((ruta) => {
      leidos.push(ruta);
      return ruta === "no-existe" ? null : '{\n  "a": 1\n}\n';
    });
    for (const donde of [enTexto('"a"'), enJson("a"), enTexto("}"), enJson("a")]) {
      ubicar({ codigo: "c", archivo: ARCHIVO, donde });
    }
    for (let veces = 0; veces < 3; veces += 1) {
      ubicar({ codigo: "c", archivo: "no-existe", donde: enTexto("x") });
      ubicar({ codigo: "c", archivo: "no-existe", donde: enJson("x") });
    }
    expect(leidos).toEqual([ARCHIVO, "no-existe"]);
  });

  it("acepta el contenido como Buffer", () => {
    expect(lineaEn(Buffer.from('{\n  "a": 1\n}\n'), enJson("a"))).toBe(2);
    expect(lineaEn(Buffer.from("uno\ndos\n"), enTexto("dos"))).toBe(2);
  });
});

describe("«texto»: la primera línea que contiene el texto", () => {
  it("es la primera, cuenta desde 1 y alcanza con que lo contenga", () => {
    const registro = [
      "// registro",
      "module.exports = [",
      '  { id: "a-b", x: 1 },',
      '  { id: "a-b" },',
      "];",
    ].join("\n");
    expect(lineaEn(registro, enTexto("// registro"))).toBe(1);
    expect(lineaEn(registro, enTexto('id: "a-b"'))).toBe(3);
    expect(lineaEn(registro, enTexto("];"))).toBe(5);
  });

  it("cuenta igual con fin de línea de Windows", () => {
    expect(lineaEn("uno\r\ndos\r\ntres", enTexto("tres"))).toBe(3);
    expect(lineaEn("uno\r\ndos\r\ntres", enTexto("dos"))).toBe(2);
  });

  it("si el texto no está, o el archivo no se puede leer, es la línea 1", () => {
    expect(lineaEn("uno\ndos", enTexto("tres"))).toBe(1);
    expect(lineaEn("", enTexto("tres"))).toBe(1);
    expect(lineaEn(null, enTexto("tres"))).toBe(1);
    expect(lineaEn(null, enTexto(""))).toBe(1);
  });
});

describe("«json»: la línea de una clave, de un elemento o del error", () => {
  const DOC = [
    "{", // 1
    '  "usa": [', // 2
    '    "uno",', // 3
    '    "dos"', // 4
    "  ],", // 5
    '  "noUsa": "x",', // 6
    '  "anidado": { "k": [ { "z": 1 } ] }', // 7
    "}", // 8
  ].join("\n");

  it.each([
    [[], 1],
    [["usa"], 2],
    [["usa", 0], 3],
    [["usa", 1], 4],
    [["noUsa"], 6],
    [["anidado"], 7],
    [["anidado", "k", 0, "z"], 7],
  ])("el camino %j está en la línea %i", (camino, linea) => {
    expect(enLinea(DOC, ...camino)).toBe(linea);
  });

  it.each([
    [["faltante"], 1],
    [["usa", 2], 2],
    [["usa", 5, 0], 2],
    [["usa", "uno"], 2],
    [["noUsa", "x"], 6],
    [["noUsa", 0], 6],
    [["anidado", "falta", "k"], 7],
    [["anidado", "k", 3, 0], 7],
  ])("si falta un tramo (%j) vale la línea del último que existe: %i", (camino, linea) => {
    expect(enLinea(DOC, ...camino)).toBe(linea);
  });

  it("un tramo faltante no se saltea: lo que viene después no se busca desde el contenedor", () => {
    const doc = '{\n  "a": {\n    "b": 1\n  }\n}\n';
    expect(enLinea(doc, "a", "x", "b")).toBe(2);
    expect(enLinea(doc, "a", "b")).toBe(3);
  });

  it("la raíz empieza en su primera línea no blanca; la clave, donde está escrita la clave", () => {
    expect(enLinea('\n\n{\n  "a":\n    1\n}', "faltante")).toBe(3);
    expect(enLinea('\n\n{\n  "a":\n    1\n}', "a")).toBe(4);
    expect(enLinea("[\n\n  1,\n\n  [2]\n]", 1)).toBe(5);
  });

  it("contenedores vacíos, anidados y con espacios por dentro", () => {
    expect(
      enLinea('{\n  "a": {},\n  "b": [],\n  "c": { },\n  "d": [\n  ],\n  "e": 1\n}', "e"),
    ).toBe(7);
    expect(enLinea("[[], {}, [ ], { }, 5]", 4)).toBe(1);
  });

  it("tabuladores y fin de línea de Windows son espacio en blanco, y cada \\n cuenta una línea", () => {
    const doc = '{\r\n\t"a": 1,\r\n\t"b": [\r\n\t\t2\r\n\t]\r\n}\r\n';
    expect(enLinea(doc, "a")).toBe(2);
    expect(enLinea(doc, "b")).toBe(3);
    expect(enLinea(doc, "b", 0)).toBe(4);
  });

  it("los espacios entre la clave y los dos puntos, y entre ellos y el valor, se saltean y se cuentan", () => {
    const doc = '{\n  "a"\n  :\n  1,\n  "b": 2\n}';
    expect(enLinea(doc, "a")).toBe(2);
    expect(enLinea(doc, "b")).toBe(5);
  });

  it("espacio en blanco al final del documento es válido", () => {
    expect(enLinea('{ "a": 1 }\n\n  \t\r\n', "a")).toBe(1);
  });

  describe("los valores literales", () => {
    const conLiteral = (literal: string): string => `{\n  "a": ${literal},\n  "b": 2\n}`;

    it.each([
      "0",
      "-0",
      "7",
      "-1",
      "10",
      "1234567",
      "0.5",
      "1.25",
      "123.456",
      "1e5",
      "1E5",
      "1e+5",
      "1e-5",
      "1E-10",
      "1e10",
      "12e34",
      "-1.5e+10",
      "2.5E3",
      "true",
      "false",
      "null",
    ])("«%s» es válido: la clave siguiente está en la línea 3", (literal) => {
      expect(enLinea(conLiteral(literal), "a")).toBe(2);
      expect(enLinea(conLiteral(literal), "b")).toBe(3);
    });

    it.each([
      "01",
      "1.",
      ".5",
      "+1",
      "1e",
      "1e+",
      "--1",
      "- 1",
      "tru",
      "nul",
      "NaN",
      "Infinity",
      "0x10",
      "1.e5",
      "'a'",
      "undefined",
    ])("«%s» no es JSON: el error está en la línea 2", (literal) => {
      expect(enLinea(conLiteral(literal), "b")).toBe(2);
    });
  });

  describe("las cadenas", () => {
    const conCadena = (contenido: string): string => `{\n  "a": "${contenido}",\n  "b": 1\n}`;

    it.each([
      "",
      "texto con espacios y ñ y €",
      '\\"',
      "\\\\",
      "\\/",
      "\\b",
      "\\f",
      "\\n",
      "\\r",
      "\\t",
      "\\u00e9",
      "\\uABCD",
      "\\uabcd",
      "\\u0041x",
      "ab\\u00e9\\u00E9cd\\n\\\\",
      'una \\\\ barra y una comilla \\" y {llaves}, [corchetes]: dos puntos',
    ])("el contenido «%s» es válido: la clave siguiente está en la línea 3", (contenido) => {
      expect(enLinea(conCadena(contenido), "a")).toBe(2);
      expect(enLinea(conCadena(contenido), "b")).toBe(3);
    });

    it.each([
      "\\x",
      "\\a",
      "\\ ",
      "\\u",
      "\\u12",
      "\\u123",
      "\\u12G4",
      "\\uZZZZ",
      "\\x1234",
      "\\a1234",
      "\\u 123",
      "\\uZZZZ abcdef",
      "abcdef \\u12G4 0123",
    ])("el escape «%s» no es JSON: el error está en la línea 2", (contenido) => {
      expect(enLinea(conCadena(contenido), "b")).toBe(2);
    });

    it("un salto de línea o un tabulador sin escapar dentro de la cadena es un error en la línea de la cadena", () => {
      expect(enLinea('{\n  "a": "uno\ndos",\n  "b": 1\n}', "b")).toBe(2);
      expect(enLinea('{\n  "a": "uno\tdos",\n  "b": 1\n}', "b")).toBe(2);
      expect(enLinea('{\n  "a": "uno\u0001dos",\n  "b": 1\n}', "b")).toBe(2);
    });

    it("la clave puede traer escapes y espacios; el espacio común no es un carácter de control", () => {
      expect(enLinea('{\n  "a b\\u00e9\\"c": 1,\n  "d": 2\n}', "d")).toBe(3);
      expect(enLinea('{\n  "a b\\u00e9\\"c": 1,\n  "d": 2\n}', 'a bé"c')).toBe(2);
    });

    it("una cadena sin cerrar es un error en el final del texto", () => {
      expect(enLinea('{\n  "a": "sin cerrar', "a")).toBe(2);
      expect(enLinea('{\n  "a": "sin cerrar\n\n', "a")).toBe(2);
      expect(enLinea('{\n  "a": "barra al final\\', "a")).toBe(2);
    });
  });

  describe("los errores de forma dan la línea donde el analizador los ve", () => {
    it.each([
      ["texto vacío", "", 1],
      ["solo espacios y saltos", "\n\n   \n", 1],
      ["objeto sin cerrar, con saltos de línea al final", '{\n  "a": 1,\n  "b":\n\n\n', 3],
      ["objeto sin cerrar, con fin de línea de Windows", '{\r\n  "a": 1,\r\n\r\n', 2],
      ["lista sin cerrar", "[\n  1,\n  2\n", 3],
      ["coma final en un objeto", '{\n  "a": 1,\n}', 3],
      ["coma final en una lista", "[\n  1,\n]", 3],
      ["coma al principio", "{\n  ,\n}", 2],
      ["clave sin comillas", '{\n  a: 1,\n  "b": 2\n}', 2],
      ["clave sin comillas con comillas más adelante", '{\n  a: "x",\n  "b": 2\n}', 2],
      ["clave que no es texto", "{\n  1: 1\n}", 2],
      ["falta el separador de clave y valor", '{\n  "a" x 1,\n  "b": 2\n}', 2],
      ["falta el separador y el valor", '{\n  "a"\n}', 3],
      ["falta la coma entre miembros", '{\n  "a": 1\n  "b": 2\n}', 3],
      ["falta la coma entre elementos", "[\n  1\n  2\n]", 3],
      ["cierre que no corresponde", "[\n  1\n}", 3],
      ["valor ausente", '{\n  "a": ,\n  "b": 1\n}', 2],
      ["texto después de la raíz", '{\n  "a": 1\n}\nsobra', 4],
      ["dos valores en la raíz", "1\n2", 2],
      ["un valor que no es JSON", "\n\nvacio", 3],
    ])("%s", (_nombre, texto, linea) => {
      expect(enLinea(texto)).toBe(linea);
    });

    it("un error en la última línea sin salto final cuenta esa línea", () => {
      expect(enLinea('{\n  "a": 1,\n  "b"', "a")).toBe(3);
    });

    it("lo que no es JSON no se confunde con un documento válido de otra línea", () => {
      expect(enLinea('\n{"a": 1,}', "a")).toBe(2);
      expect(enLinea('\n\n{"a": 1}\n  ', "a")).toBe(3);
    });
  });

  it("un anidamiento tan profundo que agota la pila no se traga como si fuera un error de forma", () => {
    expect(() => enLinea("[".repeat(100_000), 0)).toThrow(/call stack/i);
  });
});
