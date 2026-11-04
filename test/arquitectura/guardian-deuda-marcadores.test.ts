import { describe, expect, it } from "vitest";
import {
  CON_COMENTARIO_Y_SALTADA,
  JSON_Y_YAML_CON_UN_SALTO,
  NO_SALTADAS,
  SALTADAS,
  SALTADA_Y_DESPUES_UN_TODO,
  SALTADA_CON_CRLF,
  TEXTO_CON_UN_SALTO,
  TODOS_Y_SALTADAS_ENTREVERADOS,
  json,
  lineas,
  marcadores,
  tamano,
} from "./guardian-deuda-apoyo";

/**
 * El detector de marcadores de deuda técnica (`arquitectura/deuda/marcadores.cjs`): qué archivos analiza, cómo
 * separa los comentarios del código y de los literales (para no marcar texto), qué comentario es un marcador y
 * cómo cuenta las entradas de los archivos de datos. Cada marcador se afirma con su línea.
 */

const { detectar, familiaDe, lexico, tipoDeComentario } = marcadores;

/** El mismo texto en blanco: cada carácter pasa a espacio y los saltos de línea quedan. */
const enBlanco = (texto: string): string => texto.replace(/[^\n]/g, " ");

/** Los marcadores de un archivo como `tipo@línea`, en el orden en que salen. */
const vistos = (ruta: string, texto: string): string[] =>
  detectar(ruta, texto).marcadores.map((m) => `${m.tipo}@${String(m.linea)}`);

describe("qué archivos se analizan (por extensión)", () => {
  it.each([
    ["a.ts", "js"],
    ["a.tsx", "js"],
    ["a.mts", "js"],
    ["a.cts", "js"],
    ["a.js", "js"],
    ["a.jsx", "js"],
    ["a.mjs", "js"],
    ["a.cjs", "js"],
    ["a.json", "jsonc"],
    ["a.css", "css"],
    ["a.sql", "sql"],
    ["a.yml", "hash"],
    ["a.yaml", "hash"],
    ["a.toml", "hash"],
    ["carpeta/profunda/A.TS", "js"],
    ["carpeta/a.Json", "jsonc"],
  ])("%s es de la familia %s", (ruta, familia) => {
    expect(familiaDe(ruta)).toBe(familia);
  });

  it.each([
    "README.md",
    "notas.txt",
    "imagen.png",
    "datos.xml",
    "dibujo.svg",
    "Makefile",
    ".gitignore",
    ".prettierignore",
    "carpeta.ts/archivo",
    "carpeta.con.puntos/sin-extension",
    "script.sh",
  ])("%s no se analiza", (ruta) => {
    expect(familiaDe(ruta)).toBeNull();
    expect(detectar(ruta, "// TODO: algo\n")).toEqual({ marcadores: [], ilegible: null });
  });
});

describe("qué comentario es un marcador", () => {
  it.each([
    ["eslint-disable-next-line no-console", "eslint-disable"],
    ["eslint-disable", "eslint-disable"],
    ["   eslint-disable-line", "eslint-disable"],
    ["ESLINT-DISABLE", "eslint-disable"],
    ["* eslint-disable no-unused-vars", "eslint-disable"],
    ["@ts-ignore", "ts-ignore"],
    ["@ts-expect-error la etiqueta es obligatoria", "ts-expect-error"],
    ["@ts-nocheck", "ts-nocheck"],
    ["@TS-IGNORE", "ts-ignore"],
    ["/ @ts-ignore (de tres barras)", "ts-ignore"],
    ["FIXME arreglar", "todo"],
    ["HACK temporal", "todo"],
    ["XXX revisar", "todo"],
    ["TODO: arreglar", "todo"],
    ["TODO(ale): arreglar", "todo"],
    ["todo: arreglar", "todo"],
    ["Todo(ale)", "todo"],
    ["fixme: x", "todo"],
    ["Hack : x", "todo"],
    ["xxx(x)", "todo"],
    ["TODO", "todo"],
    ["  todo  ", "todo"],
    ["# TODO: en un yaml", "todo"],
    ["** TODO: decoración", "todo"],
  ])("«%s» es %s", (texto, tipo) => {
    expect(tipoDeComentario(texto)).toBe(tipo);
  });

  it.each([
    "TODO junto, el segundo factor se exige",
    "TODO lo demás es un objeto que lanza",
    "Todo el mundo",
    "cubre TODO: conexión, envío y lectura",
    "hack temporal",
    "hacker: x",
    "HACKER x",
    "todos: los casos",
    "un eslint-disable en medio",
    "eslint-enable",
    "@ts-check",
    "@ts-ignorar",
    "prosa común",
    "",
    "   ",
  ])("«%s» no es un marcador", (texto) => {
    expect(tipoDeComentario(texto)).toBeNull();
  });
});

describe("el analizador léxico separa comentarios, código y literales", () => {
  const js = (texto: string) => lexico(texto, "js");

  it("un comentario de línea se corta en el salto y no incluye su delimitador", () => {
    const { comentarios, codigo, visible } = js("a(); // uno\nb(); //dos\n");
    expect(comentarios).toEqual([
      { linea: 1, texto: " uno" },
      { linea: 2, texto: "dos" },
    ]);
    expect(codigo).toBe("a();       \nb();      \n");
    expect(visible).toBe("a();       \nb();      \n");
  });

  it("un comentario de línea al final del texto, sin salto, también cuenta", () => {
    expect(js("// final").comentarios).toEqual([{ linea: 1, texto: " final" }]);
  });

  it("un comentario de bloque se parte en una entrada por línea, con la línea real de cada una", () => {
    const { comentarios, codigo } = js("x;\n/**\n * @ts-ignore a\n * b\n */\ny;\n");
    expect(comentarios).toEqual([
      { linea: 2, texto: "*" },
      { linea: 3, texto: " * @ts-ignore a" },
      { linea: 4, texto: " * b" },
      { linea: 5, texto: " " },
    ]);
    expect(codigo.split("\n").map((l) => l.trim())).toEqual(["x;", "", "", "", "", "y;", ""]);
  });

  it("un comentario de bloque sin cerrar llega hasta el final", () => {
    expect(js("a;\n/* sin cerrar\nTODO: b").comentarios).toEqual([
      { linea: 2, texto: " sin cerrar" },
      { linea: 3, texto: "TODO: b" },
    ]);
  });

  it("las líneas se cuentan con los saltos de los textos y de los comentarios de bloque", () => {
    const { comentarios } = js('const a = "x\\\ny";\n/* a\nb */ // c\n');
    expect(comentarios).toEqual([
      { linea: 3, texto: " a" },
      { linea: 4, texto: "b " },
      { linea: 4, texto: " c" },
    ]);
  });

  it("un texto entre comillas no contiene comentarios (ni con la comilla escapada), y queda en `visible` pero no en `codigo`", () => {
    const { comentarios, codigo, visible } = js(
      `a = "// TODO: no"; b = '/* x */'; c = "\\" // n";`,
    );
    expect(comentarios).toEqual([]);
    expect(codigo).toBe(
      `a = ${enBlanco('"// TODO: no"')}; b = ${enBlanco("'/* x */'")}; c = ${enBlanco('"\\" // n"')};`,
    );
    expect(visible).toBe(`a = "// TODO: no"; b = '/* x */'; c = "\\" // n";`);
  });

  it("un texto sin cerrar termina en el salto de línea: lo que sigue vuelve a ser código", () => {
    const { comentarios, codigo } = js("a = 'it\nb(); // c\n");
    expect(comentarios).toEqual([{ linea: 2, texto: " c" }]);
    expect(codigo).toBe("a =    \nb();     \n");
  });

  it("un texto sin cerrar al final del archivo no deja el recorrido colgado", () => {
    expect(js('a = "abc').codigo).toBe("a =     ");
    expect(js('a = "abc\\').codigo).toBe("a =      ");
  });

  it("una plantilla no contiene comentarios, pero sí sus expresiones `${}` (con llaves y plantillas anidadas)", () => {
    const fuente =
      "t = `a // no ${ x /* sí */ } b ${ { k: 1 }.k + `h ${ y } // no` } // no`; // fin\n";
    const { comentarios, codigo } = js(fuente);
    expect(comentarios).toEqual([
      { linea: 1, texto: " sí " },
      { linea: 1, texto: " fin" },
    ]);
    expect(codigo).toBe(
      `t = ${enBlanco("`a // no ${")} x ${enBlanco("/* sí */ } b ${")} { k: 1 }.k + ` +
        `${enBlanco("`h ${")} y ${enBlanco("} // no` } // no`")}; ${enBlanco("// fin")}\n`,
    );
  });

  it("una plantilla sin cerrar llega hasta el final y una barra escapa lo que sigue", () => {
    expect(js("a = `x\n// no").comentarios).toEqual([]);
    expect(js("a = `x\\` // no`; // sí").comentarios).toEqual([{ linea: 1, texto: " sí" }]);
    expect(js("a = `x\\").comentarios).toEqual([]);
  });

  it("un `$` o una `{` sueltos en una plantilla no abren una expresión; una `}` suelta fuera de ella tampoco cierra nada", () => {
    expect(js("a = `$x {y}` // c").comentarios).toEqual([{ linea: 1, texto: " c" }]);
    expect(js("} // c\n").comentarios).toEqual([{ linea: 1, texto: " c" }]);
  });

  it("después de un `${…}` cerrado la plantilla sigue hasta su propio cierre", () => {
    expect(js("a = `${1} // no` // sí").comentarios).toEqual([{ linea: 1, texto: " sí" }]);
  });

  it("una expresión regular no contiene comentarios ni comillas (también con `/` dentro de una clase y con banderas)", () => {
    const { comentarios, codigo } = js("a = /['\"]/g; b = /[/]\\//i; // c\n");
    expect(comentarios).toEqual([{ linea: 1, texto: " c" }]);
    expect(codigo).toBe(
      `a = ${enBlanco("/['\"]/g")}; b = ${enBlanco("/[/]\\//i")}; ${enBlanco("// c")}\n`,
    );
  });

  it.each([
    ["a = /x/", true],
    ["f(/x/)", true],
    ["[/x/]", true],
    ["a, /x/", true],
    ["a ? /x/ : /y/", true],
    ["a && /x/", true],
    ["a || /x/", true],
    ["!/x/", true],
    ["{ /x/ }", true],
    ["a; /x/", true],
    ["a + /x/", true],
    ["a - /x/", true],
    ["a * /x/", true],
    ["a % /x/", true],
    ["a ^ /x/", true],
    ["~/x/", true],
    ["a: /x/", true],
    ["return /x/", true],
    ["return/x/", true],
    ["typeof /x/", true],
    ["/x/", true],
    ["a / b / c", false],
    ["f() / 2 / 3", false],
    ["x[0] / 2 / 3", false],
    ["1 / 2 / 3", false],
    ["retorno / 2 / 3", false],
    ["a /b/ c", false],
  ])("«%s»: ¿la barra abre una expresión regular? %s", (fuente, esRegex) => {
    // Con una regex, el `//` que sigue es un comentario real solo cuando la regex NO se tragó la línea.
    const { codigo } = js(`${fuente} // c`);
    expect(codigo.includes("/") || !esRegex).toBe(!esRegex);
  });

  it("una división no abre una regex: lo que sigue de la línea sigue siendo código", () => {
    const { comentarios, codigo } = js("a = b / c; d = e / f; // c\n");
    expect(comentarios).toEqual([{ linea: 1, texto: " c" }]);
    expect(codigo).toBe("a = b / c; d = e / f;     \n");
  });

  it("una `/` que abre una regex pero no cierra en la línea es una división, y la línea siguiente sigue en código", () => {
    const { comentarios, codigo } = js("a = /abc\nb(); // c\n");
    expect(comentarios).toEqual([{ linea: 2, texto: " c" }]);
    expect(codigo).toBe("a = /abc\nb();     \n");
  });

  it("después de una palabra clave que admite una expresión, una `/` abre una regex; después de un nombre que la contiene, no", () => {
    expect(js("x = typeof /a/; // c").comentarios).toEqual([{ linea: 1, texto: " c" }]);
    expect(js("x = a1 / b1 // c").comentarios).toEqual([{ linea: 1, texto: " c" }]);
    // `do` termina una palabra clave; `redo` no es una de ellas
    expect(js("do /a/.test(x); // c").comentarios).toEqual([{ linea: 1, texto: " c" }]);
    expect(js("redo / a / b // c").comentarios).toEqual([{ linea: 1, texto: " c" }]);
  });

  it("después de un texto o de una regex, una `/` divide", () => {
    expect(js('a = "x" / 2 // c').comentarios).toEqual([{ linea: 1, texto: " c" }]);
    expect(js("a = /x/ / 2 // c").comentarios).toEqual([{ linea: 1, texto: " c" }]);
    expect(js("a = `x` / 2 // c").comentarios).toEqual([{ linea: 1, texto: " c" }]);
  });

  it("los nombres con números, guion bajo y `$` forman una sola palabra", () => {
    expect(js("return2 / 2 / 3 // c").comentarios).toEqual([{ linea: 1, texto: " c" }]);
    expect(js("$return / 2 / 3 // c").comentarios).toEqual([{ linea: 1, texto: " c" }]);
    expect(js("_in / 2 / 3 // c").comentarios).toEqual([{ linea: 1, texto: " c" }]);
  });

  it("jsonc: comentarios de línea y de bloque; las URL dentro de un texto no son comentarios", () => {
    const fuente = lineas(
      "{",
      '  "$schema": "https://x.y/z.json", // uno',
      '  /* dos */ "a": 1',
      "}",
    );
    const { comentarios, visible } = lexico(fuente, "jsonc");
    expect(comentarios).toEqual([
      { linea: 2, texto: " uno" },
      { linea: 3, texto: " dos " },
    ]);
    expect(JSON.parse(visible)).toEqual({ $schema: "https://x.y/z.json", a: 1 });
    // en jsonc no hay plantillas ni regex: la comilla simple no abre nada, la tilde no abre una plantilla
    expect(lexico("`a // c", "jsonc").comentarios).toEqual([{ linea: 1, texto: " c" }]);
    expect(lexico("x = /a/ // c", "jsonc").comentarios).toEqual([{ linea: 1, texto: " c" }]);
    expect(lexico("it's // c", "jsonc").comentarios).toEqual([{ linea: 1, texto: " c" }]);
  });

  it("css: solo comentarios de bloque; `//` es parte de una URL", () => {
    const { comentarios } = lexico(
      "a { background: url(http://x/y.png); } /* TODO: z */\nb { content: '/* no */'; }\n",
      "css",
    );
    expect(comentarios).toEqual([{ linea: 1, texto: " TODO: z " }]);
  });

  it("sql: `--` y comentarios de bloque; las comillas simples abren un texto", () => {
    const { comentarios } = lexico("select '-- no'; -- TODO: sí\n/* x */ select 1;\n", "sql");
    expect(comentarios).toEqual([
      { linea: 1, texto: " TODO: sí" },
      { linea: 2, texto: " x " },
    ]);
  });

  it("hash: `#` solo abre un comentario al principio de la línea o después de un espacio", () => {
    const { comentarios } = lexico(
      "# uno\na: b # dos\nc: http://x#frag\nd: 'e # no'\ne:\t# tres\n",
      "hash",
    );
    expect(comentarios).toEqual([
      { linea: 1, texto: " uno" },
      { linea: 2, texto: " dos" },
      { linea: 5, texto: " tres" },
    ]);
    // sin comentarios de bloque en esta familia
    expect(lexico("a: /* no */ b\n", "hash").comentarios).toEqual([]);
  });
});

describe("los marcadores de un archivo de código, con su línea", () => {
  it("encuentra cada tipo de comentario en su línea y los ordena por línea", () => {
    const fuente = lineas(
      "// TODO: uno",
      "const a = 1; // FIXME dos",
      "/* eslint-disable no-console */",
      "// eslint-disable-next-line no-console -- motivo",
      "// @ts-ignore",
      "// @ts-expect-error motivo",
      "// @ts-nocheck",
      "/**",
      " * HACK: tres",
      " */",
      "// XXX cuatro",
    );
    expect(vistos("src/a.ts", fuente)).toEqual([
      "todo@1",
      "todo@2",
      "eslint-disable@3",
      "eslint-disable@4",
      "ts-ignore@5",
      "ts-expect-error@6",
      "ts-nocheck@7",
      "todo@9",
      "todo@11",
    ]);
  });

  it("dos marcadores en la misma línea salen en el orden en que se hallaron: comentario, código, datos", () => {
    expect(vistos("a.ts", CON_COMENTARIO_Y_SALTADA("// TODO: x"))).toEqual([
      "todo@1",
      "prueba-saltada@1",
    ]);
    expect(vistos("a.ts", CON_COMENTARIO_Y_SALTADA("// @ts-ignore"))).toEqual([
      "ts-ignore@1",
      "prueba-saltada@1",
    ]);
    expect(vistos("a.ts", CON_COMENTARIO_Y_SALTADA("// eslint-disable-line"))).toEqual([
      "eslint-disable@1",
      "prueba-saltada@1",
    ]);
    expect(vistos("knip.json", '{ "ignore": ["a"] } // TODO: x\n')).toEqual([
      "todo@1",
      "knip-ignora@1",
    ]);
  });

  it("no cuenta lo que está dentro de textos, plantillas y expresiones regulares", () => {
    const fuente = lineas(
      'const a = "// TODO: no";',
      "const b = `// eslint-disable`;",
      "const c = /\\/\\/ @ts-ignore/;",
      "const d = '/* FIXME */';",
      TEXTO_CON_UN_SALTO,
    );
    expect(vistos("a.ts", fuente)).toEqual([]);
  });

  it("la marca tiene que estar al principio del comentario: en medio de una frase no es un marcador", () => {
    const fuente = lineas(
      "// cubre TODO: conexión",
      "// TODO junto, el segundo factor",
      "// habilitado por eslint-disable",
      "/** Un POST SOAP que cubre TODO. */",
    );
    expect(vistos("a.ts", fuente)).toEqual([]);
  });

  it("un archivo con BOM se lee igual y las líneas no se corren", () => {
    expect(vistos("a.ts", "﻿// TODO: x\n")).toEqual(["todo@1"]);
    expect(vistos("a.ts", "﻿\n// TODO: x\n")).toEqual(["todo@2"]);
  });

  it("un texto vacío no tiene marcadores", () => {
    expect(detectar("a.ts", "")).toEqual({ marcadores: [], ilegible: null });
  });

  it("las pruebas saltadas se buscan solo en el código, con su línea", () => {
    expect(SALTADAS).toHaveLength(13);
    expect(vistos("a.test.ts", lineas(...SALTADAS))).toEqual(
      Array.from({ length: 13 }, (_, i) => `prueba-saltada@${String(i + 1)}`),
    );
  });

  it("no son pruebas saltadas: las condicionales, los textos, los comentarios ni los nombres parecidos", () => {
    expect(vistos("a.test.ts", lineas(...NO_SALTADAS))).toEqual([]);
  });

  it("las pruebas saltadas solo valen en código: en un .json, un .yml o un .css no", () => {
    expect(vistos("a.json", '{ "a": 1 }\n')).toEqual([]);
    expect(vistos("a.css", JSON_Y_YAML_CON_UN_SALTO)).toEqual([]);
    expect(vistos("a.yml", `run: ${JSON_Y_YAML_CON_UN_SALTO}`)).toEqual([]);
  });

  it("el rango de líneas de una línea CRLF no se corre", () => {
    expect(vistos("a.ts", SALTADA_CON_CRLF)).toEqual(["todo@2", "prueba-saltada@3"]);
  });
});

describe("continue-on-error en un yml", () => {
  const flujo = lineas(
    "jobs:",
    "  a:",
    "    continue-on-error: true",
    "    steps:",
    "      - run: echo",
    "        continue-on-error : true",
    "      # continue-on-error: true",
    "      - run: echo 'continue-on-error: true'",
  );

  it("cuenta la clave en su línea, con o sin espacio antes de los dos puntos, no en un comentario ni en un texto", () => {
    expect(vistos(".github/workflows/ci.yml", flujo)).toEqual([
      "continue-on-error@3",
      "continue-on-error@6",
    ]);
    expect(vistos("flujo.yaml", flujo)).toEqual(["continue-on-error@3", "continue-on-error@6"]);
  });

  it("solo en los yml: un .toml o un .ts con el mismo texto no cuentan", () => {
    expect(vistos("a.toml", "continue-on-error: true\n")).toEqual([]);
    expect(vistos("a.ts", "continue-on-error: true\n")).toEqual([]);
  });

  it("un comentario TODO en un yml o en un toml sí cuenta", () => {
    expect(vistos("a.yml", "a: 1 # TODO: x\n")).toEqual(["todo@1"]);
    expect(vistos("a.toml", "# FIXME x\n")).toEqual(["todo@1"]);
  });
});

describe("los comentarios de las demás familias", () => {
  it("css, sql y json cuentan sus comentarios marcadores", () => {
    expect(vistos("a.css", "a { }\n/* TODO: x */\n")).toEqual(["todo@2"]);
    expect(vistos("a.sql", "select 1; -- FIXME x\n/* HACK */\n")).toEqual(["todo@1", "todo@2"]);
    expect(vistos("a.json", '{ // TODO: x\n  "a": "// TODO: no"\n}\n')).toEqual(["todo@1"]);
  });
});

describe("knip.json: una entrada por cada elemento o clave de los `ignore*`", () => {
  const KNIP = lineas(
    "{",
    '  "$schema": "https://unpkg.com/knip@6/schema.json",',
    '  "workspaces": {',
    '    ".": {',
    "      // comentario que no cuenta",
    '      "ignoreDependencies": [',
    '        "next",',
    '        "otra"',
    "      ],",
    '      "ignoreBinaries": ["x"],',
    '      "ignoreMembers": [],',
    '      "entry": ["src/**/*.ts"]',
    "    },",
    '    "apps/web": { "ignoreUnresolved": ["y"], "ignore": ["z", "w"] }',
    "  },",
    '  "ignoreIssues": {',
    '    "a.cjs": ["exports"],',
    '    "b.cjs": ["exports", "types"]',
    "  },",
    '  "ignoreWorkspaces": ["apps/viejo"],',
    '  "ignoreExportsUsedInFile": true',
    "}",
  );

  it("cuenta los elementos de las listas y las claves de los objetos, en cualquier profundidad", () => {
    expect(vistos("knip.json", KNIP)).toEqual([
      "knip-ignora@7",
      "knip-ignora@8",
      "knip-ignora@10",
      "knip-ignora@14",
      "knip-ignora@14",
      "knip-ignora@14",
      "knip-ignora@17",
      "knip-ignora@18",
      "knip-ignora@20",
    ]);
  });

  it("vale también en un knip.json de una carpeta, y no en un archivo que solo termina igual", () => {
    expect(vistos("apps/web/knip.json", '{ "ignore": ["a"] }\n')).toEqual(["knip-ignora@1"]);
    expect(vistos("miknip.json", '{ "ignore": ["a"] }\n')).toEqual([]);
    expect(vistos("knip.jsonc", '{ "ignore": ["a"] }\n')).toEqual([]);
  });

  it("un valor que no es lista ni objeto, o una lista vacía, no suma", () => {
    expect(
      vistos("knip.json", '{ "ignore": [], "ignoreIssues": {}, "ignoreBinaries": true }\n'),
    ).toEqual([]);
    expect(vistos("knip.json", "[1, 2]\n")).toEqual([]);
  });

  it("un knip.json que no es JSON válido es ilegible, con la línea del error", () => {
    expect(detectar("knip.json", '{\n  "ignore": [\n')).toEqual({
      marcadores: [],
      ilegible: { linea: 2, motivo: "no es JSON válido" },
    });
  });
});

describe("las excepciones y las exclusiones del guardián: una entrada por elemento", () => {
  const lista = json([
    { id: "excl-generado", alcance: "clase" },
    { alcance: "clase", id: "excl-docs" },
    { alcance: "ruta" },
  ]);

  it.each(["arquitectura/contratos/excepciones.json", "arquitectura/contratos/exclusiones.json"])(
    "%s: la línea del id de cada entrada, o la de su apertura si no tiene",
    (ruta) => {
      // las entradas arrancan en las líneas 2, 6 y 10; el id está en la 3, en la 8 y la tercera no tiene
      expect(vistos(ruta, lista)).toEqual([
        "excepcion-del-guardian@3",
        "excepcion-del-guardian@8",
        "excepcion-del-guardian@10",
      ]);
    },
  );

  it("una lista vacía, un objeto o un elemento que no es objeto no suman, y otro archivo no es de estos", () => {
    expect(vistos("arquitectura/contratos/excepciones.json", "[]\n")).toEqual([]);
    expect(vistos("arquitectura/contratos/excepciones.json", "{}\n")).toEqual([]);
    expect(vistos("arquitectura/contratos/excepciones.json", "[1]\n")).toEqual([
      "excepcion-del-guardian@1",
    ]);
    expect(vistos("otra/excepciones.json", lista)).toEqual([]);
    expect(vistos("arquitectura/contratos/exclusiones.jsonc", lista)).toEqual([]);
  });

  it("si no es JSON válido es ilegible", () => {
    expect(detectar("arquitectura/contratos/exclusiones.json", "[\n{\n").ilegible).toEqual({
      linea: 2,
      motivo: "no es JSON válido",
    });
  });
});

describe("grupos-de-mutacion.json: un marcador por grupo sin `pruebas`", () => {
  const grupos = json([
    { grupo: "con filtro", archivos: "a", pruebas: "src/a" },
    { grupo: "sin filtro", archivos: "b" },
    { grupo: "filtro vacío", archivos: "c", pruebas: "  " },
    { grupo: "filtro que no es texto", archivos: "d", pruebas: 5 },
    { archivos: "e" },
    { grupo: "otro con filtro", archivos: "f", pruebas: "src/f" },
  ]);

  it("cuenta cada grupo sin `pruebas` (ausente, vacío o que no es texto) en la línea de su `grupo`", () => {
    // cada grupo ocupa 4 líneas ({, grupo, archivos, }) o 5 con pruebas; el sin-grupo arranca en la 19
    expect(vistos("arquitectura/grupos-de-mutacion.json", grupos)).toEqual([
      "mutacion-sin-filtro@8",
      "mutacion-sin-filtro@12",
      "mutacion-sin-filtro@17",
      "mutacion-sin-filtro@21",
    ]);
  });

  it("sin grupos sin filtro no hay marcadores (el detector pasa cuando no queda ninguno)", () => {
    expect(
      vistos(
        "arquitectura/grupos-de-mutacion.json",
        json([{ grupo: "a", archivos: "x", pruebas: "src/x" }]),
      ),
    ).toEqual([]);
    expect(vistos("arquitectura/grupos-de-mutacion.json", "[]\n")).toEqual([]);
  });

  it("un objeto en vez de una lista no suma y otro archivo con ese nombre no cuenta", () => {
    expect(vistos("arquitectura/grupos-de-mutacion.json", "{}\n")).toEqual([]);
    expect(vistos("otra/grupos-de-mutacion.json", grupos)).toEqual([]);
  });

  it("un elemento que no es objeto cuenta como grupo sin filtro, en su línea", () => {
    expect(vistos("arquitectura/grupos-de-mutacion.json", "[\n  5\n]\n")).toEqual([
      "mutacion-sin-filtro@2",
    ]);
  });
});

describe("el catálogo de tipos", () => {
  it("cada tipo tiene su descripción, y están todos los que el detector puede emitir", () => {
    expect(marcadores.TIPOS_DE_MARCADOR).toEqual([
      "eslint-disable",
      "ts-ignore",
      "ts-expect-error",
      "ts-nocheck",
      "todo",
      "prueba-saltada",
      "knip-ignora",
      "excepcion-del-guardian",
      "mutacion-sin-filtro",
      "continue-on-error",
      "archivo-grande",
    ]);
    expect(Object.keys(marcadores.DESCRIPCION_DE_MARCADORES)).toEqual([
      ...marcadores.TIPOS_DE_MARCADOR,
    ]);
    for (const descripcion of Object.values(marcadores.DESCRIPCION_DE_MARCADORES)) {
      expect(descripcion.length).toBeGreaterThan(20);
    }
  });
});

describe("las expresiones regulares y las divisiones", () => {
  const TODO_AL_FINAL = "// TODO: x";

  it.each([..."(,=:[!&|?{};+-*%^~"])("después de `%s` un `/` abre una expresión regular", (c) => {
    expect(vistos("a.ts", `a ${c} /'/ ${TODO_AL_FINAL}\n`)).toEqual(["todo@1"]);
  });

  it.each([")", "]", "a", "Z", "7", "_", "$"])(
    "después de `%s` un `/` divide: lo que sigue es código",
    (c) => {
      expect(vistos("a.ts", `x ${c} / 2; ${TODO_AL_FINAL}\n`)).toEqual(["todo@1"]);
    },
  );

  it.each(['"s"', "'s'", "`t`", "/r/", "/r/gi"])(
    "después de un literal (%s) un `/` divide",
    (v) => {
      expect(vistos("a.ts", `x = ${v} / 2; ${TODO_AL_FINAL}\n`)).toEqual(["todo@1"]);
    },
  );

  it.each([
    "return",
    "typeof",
    "case",
    "in",
    "of",
    "delete",
    "void",
    "throw",
    "new",
    "else",
    "do",
    "yield",
    "await",
  ])(
    "después de la palabra `%s` un `/` abre una expresión regular (con blancos o pegado)",
    (palabra) => {
      expect(vistos("a.ts", `ab ${palabra} /'/ ${TODO_AL_FINAL}\n`)).toEqual(["todo@1"]);
      expect(vistos("a.ts", `ab ${palabra}  /'/ ${TODO_AL_FINAL}\n`)).toEqual(["todo@1"]);
      expect(vistos("a.ts", `ab ${palabra}\t/'/ ${TODO_AL_FINAL}\n`)).toEqual(["todo@1"]);
      expect(vistos("a.ts", `ab ${palabra}/'/ ${TODO_AL_FINAL}\n`)).toEqual(["todo@1"]);
    },
  );

  it("la palabra clave pegada a un signo que la precede vale igual", () => {
    for (const antes of [";", "(", "{", "}", ",", "=", ")", "]", '"s"', "/r/"]) {
      expect(vistos("a.ts", `a${antes}return /'/ ${TODO_AL_FINAL}\n`), antes).toEqual(["todo@1"]);
      expect(vistos("a.ts", `a${antes}typeof/'/ ${TODO_AL_FINAL}\n`), antes).toEqual(["todo@1"]);
    }
  });

  it("una palabra que solo se parece a una palabra clave no cuenta", () => {
    for (const palabra of ["retur", "returns", "xreturn", "return1", "inn", "undo"]) {
      expect(vistos("a.ts", `${palabra} / 2; ${TODO_AL_FINAL}\n`)).toEqual(["todo@1"]);
    }
  });

  it("la palabra clave deja de valer después de un signo o de un literal", () => {
    expect(vistos("a.ts", `return ) / 2; ${TODO_AL_FINAL}\n`)).toEqual(["todo@1"]);
    expect(vistos("a.ts", `return (a) / 2; ${TODO_AL_FINAL}\n`)).toEqual(["todo@1"]);
    expect(vistos("a.ts", `return "s" / 2; ${TODO_AL_FINAL}\n`)).toEqual(["todo@1"]);
    expect(vistos("a.ts", `return a / 2; ${TODO_AL_FINAL}\n`)).toEqual(["todo@1"]);
  });

  it("una palabra clave de más atrás no vale: la última palabra es la que cuenta", () => {
    expect(vistos("a.ts", `return a b / 2; ${TODO_AL_FINAL}\n`)).toEqual(["todo@1"]);
    expect(vistos("a.ts", `x in /'/ ${TODO_AL_FINAL}\n`)).toEqual(["todo@1"]);
    expect(vistos("a.ts", `"a" in /'/ ${TODO_AL_FINAL}\n`)).toEqual(["todo@1"]);
    expect(vistos("a.ts", `(a) in /'/ ${TODO_AL_FINAL}\n`)).toEqual(["todo@1"]);
  });

  it("una palabra clave al empezar el archivo, o después de un texto o de una interpolación, vale igual", () => {
    expect(vistos("a.ts", `return /'/ ${TODO_AL_FINAL}\n`)).toEqual(["todo@1"]);
    expect(vistos("a.ts", `typeof/'/ ${TODO_AL_FINAL}\n`)).toEqual(["todo@1"]);
    expect(vistos("a.ts", `x"s"in /'/ ${TODO_AL_FINAL}\n`)).toEqual(["todo@1"]);
    expect(vistos("a.ts", `a\`\${typeof /'/.x}\`; ${TODO_AL_FINAL}\n`)).toEqual(["todo@1"]);
    expect(vistos("a.ts", `ab\`\${return /'/}\`; ${TODO_AL_FINAL}\n`)).toEqual(["todo@1"]);
  });

  it("una barra sin cierre al empezar el archivo es código, no una expresión", () => {
    expect(lexico("/abc", "js").codigo).toBe("/abc");
    expect(lexico("/ 2;\n// TODO: x", "js").codigo).toBe(`/ 2;\n${enBlanco("// TODO: x")}`);
    expect(vistos("a.ts", "/ 2;\n// TODO: x\n")).toEqual(["todo@2"]);
  });

  it("al empezar el archivo un `/` abre una expresión regular", () => {
    expect(vistos("a.ts", `/'/.test(a); ${TODO_AL_FINAL}\n`)).toEqual(["todo@1"]);
    expect(vistos("a.ts", `\n  /'/.test(a); ${TODO_AL_FINAL}\n`)).toEqual(["todo@2"]);
  });

  it("justo después de un `${` un `/` abre una expresión regular", () => {
    expect(vistos("a.ts", `\`\${/'/.source}\`; ${TODO_AL_FINAL}\n`)).toEqual(["todo@1"]);
  });

  it("una expresión regular sin cerrar en la línea es una división y no se come lo que sigue", () => {
    expect(vistos("a.ts", "x = /abc")).toEqual([]);
    expect(vistos("a.ts", "x = /abc\n// TODO: y\n")).toEqual(["todo@2"]);
    expect(vistos("a.ts", "x = / 2;\n// TODO: y\n")).toEqual(["todo@2"]);
    expect(lexico("x = /abc", "js").codigo).toBe("x = /abc");
  });

  it("la barra escapada y la clase de caracteres no cierran la expresión", () => {
    expect(vistos("a.ts", `x = /\\// ${TODO_AL_FINAL}\n`)).toEqual(["todo@1"]);
    expect(vistos("a.ts", `x = /[/]/ ${TODO_AL_FINAL}\n`)).toEqual(["todo@1"]);
    expect(lexico("x = /[a]/g;", "js").codigo).toBe(`x = ${enBlanco("/[a]/g")};`);
    expect(lexico("x = /[a]/;", "js").codigo).toBe(`x = ${enBlanco("/[a]/")};`);
  });

  it("las banderas de la expresión son parte de ella; sin banderas, al final del archivo, termina", () => {
    expect(lexico("x = /a/gi;", "js").codigo).toBe(`x = ${enBlanco("/a/gi")};`);
    expect(lexico("x = /a/", "js").codigo).toBe(`x = ${enBlanco("/a/")}`);
    expect(lexico("x = /a/gi", "js").codigo).toBe(`x = ${enBlanco("/a/gi")}`);
    expect(lexico("x = /a/Gi", "js").codigo).toBe(`x = ${enBlanco("/a/")}Gi`);
  });
});

describe("los textos y las plantillas", () => {
  it("un texto sin cerrar corta en el salto de línea o al final del archivo", () => {
    expect(vistos("a.ts", '"abc')).toEqual([]);
    expect(vistos("a.ts", '"abc\n// TODO: x\n')).toEqual(["todo@2"]);
    expect(lexico('"abc', "js").codigo).toBe("    ");
  });

  it("la barra escapa la comilla y la barra al final no rompe", () => {
    expect(vistos("a.ts", '"a\\"b" // TODO: x\n')).toEqual(["todo@1"]);
    expect(vistos("a.ts", "'a\\'b' // TODO: x\n")).toEqual(["todo@1"]);
    expect(lexico('"abc\\', "js").codigo).toBe("     ");
  });

  it("una plantilla esconde lo que tiene dentro, incluido un comentario", () => {
    expect(vistos("a.ts", "`a // TODO: x`;\n// TODO: y\n")).toEqual(["todo@2"]);
    expect(vistos("a.ts", "`a\n// TODO: x\n`;\n// TODO: y\n")).toEqual(["todo@4"]);
  });

  it("la comilla invertida y el `${` escapados no abren ni cierran nada", () => {
    expect(vistos("a.ts", "`a\\`b // TODO: x`;\n// TODO: y\n")).toEqual(["todo@2"]);
    expect(vistos("a.ts", "`\\${ // TODO: x`;\n// TODO: y\n")).toEqual(["todo@2"]);
    expect(vistos("a.ts", "`\\\\` // TODO: x\n")).toEqual(["todo@1"]);
  });

  it("una `{` precedida de cualquier carácter que no sea `$` es texto de la plantilla", () => {
    expect(vistos("a.ts", "`a{ // TODO: x`;\n// TODO: y\n")).toEqual(["todo@2"]);
    expect(vistos("a.ts", "`${ a } {b // TODO: x`;\n// TODO: y\n")).toEqual(["todo@2"]);
    expect(vistos("a.ts", "`}{ // TODO: x`;\n// TODO: y\n")).toEqual(["todo@2"]);
  });

  it("una `{` o un `$` sueltos dentro de la plantilla son texto", () => {
    expect(vistos("a.ts", "`{ // TODO: x $ `;\n// TODO: y\n")).toEqual(["todo@2"]);
    expect(vistos("a.ts", "`$x { } $ // TODO: x`;\n// TODO: y\n")).toEqual(["todo@2"]);
  });

  it("dentro de un `${` hay código: un comentario cuenta y el cierre devuelve a la plantilla", () => {
    expect(vistos("a.ts", "`${ a // TODO: x\n }`;\n")).toEqual(["todo@1"]);
    expect(vistos("a.ts", "`${ a } // TODO: x`;\n// TODO: y\n")).toEqual(["todo@2"]);
  });

  it("las llaves propias de una interpolación no la cierran antes de tiempo", () => {
    expect(vistos("a.ts", "`${ { a: 1 }.a } // TODO: x`;\n// TODO: y\n")).toEqual(["todo@2"]);
    expect(vistos("a.ts", "`${ (() => { return 1; })() } // TODO: x`;\n// TODO: y\n")).toEqual([
      "todo@2",
    ]);
    expect(vistos("a.ts", "`${ { a: { b: 1 } } } // TODO: x`;\n// TODO: y\n")).toEqual(["todo@2"]);
    expect(vistos("a.ts", "`${ '}' } // TODO: x`;\n// TODO: y\n")).toEqual(["todo@2"]);
  });

  it("las plantillas se anidan y cada una vuelve a la anterior", () => {
    expect(vistos("a.ts", "`a${ `b${ c }d` }e // TODO: x`;\n// TODO: y\n")).toEqual(["todo@2"]);
    expect(vistos("a.ts", "`${ `${ a }` } ${ b } // TODO: x`;\n// TODO: y\n")).toEqual(["todo@2"]);
  });

  it("una `}` suelta fuera de toda plantilla es código y no corta el análisis", () => {
    expect(vistos("a.ts", "}\n// TODO: x\n")).toEqual(["todo@2"]);
    expect(vistos("a.ts", "if (a) { b(); }\n// TODO: x\n")).toEqual(["todo@2"]);
    expect(vistos("a.ts", "`${ a }`;\n}\n// TODO: x\n")).toEqual(["todo@3"]);
  });

  it("una plantilla o una interpolación sin cerrar llega al final sin romper el largo", () => {
    for (const texto of ["`abc", "`${ a", "`${ a }", "`${", "`\\", "`${ `x"]) {
      const { codigo, visible } = lexico(texto, "js");
      expect(codigo).toHaveLength(texto.length);
      expect(visible).toHaveLength(texto.length);
    }
  });

  it("en css, sql, yml y json la comilla invertida es un carácter más", () => {
    expect(vistos("a.json", "[\n  `\n]\n/* TODO: x */\n")).toEqual(["todo@4"]);
    expect(vistos("a.css", "`\n/* TODO: x */\n")).toEqual(["todo@2"]);
    expect(vistos("a.sql", "`\n/* TODO: x */\n")).toEqual(["todo@2"]);
    expect(vistos("a.yml", "`\n# TODO: x\n")).toEqual(["todo@2"]);
  });

  it("en css, sql, yml y json una barra no abre una expresión regular", () => {
    expect(vistos("a.json", "[ /b /* TODO: x */ 1 ]")).toEqual(["todo@1"]);
    expect(vistos("a.css", "a: /b /* TODO: x */;")).toEqual(["todo@1"]);
    expect(vistos("a.sql", "x = /b /* TODO: x */")).toEqual(["todo@1"]);
    expect(vistos("a.yml", "a: /b # TODO: x /\n")).toEqual(["todo@1"]);
  });
});

describe("qué devuelve el analizador léxico, carácter por carácter", () => {
  it("el código deja los comentarios y los literales en blanco; lo visible solo los comentarios", () => {
    const texto = 'a /* c */ "s" // d\nb';
    const { codigo, visible, comentarios } = lexico(texto, "js");
    expect(codigo).toBe(`a ${enBlanco("/* c */")} ${enBlanco('"s"')} ${enBlanco("// d")}\nb`);
    expect(visible).toBe(`a ${enBlanco("/* c */")} "s" ${enBlanco("// d")}\nb`);
    expect(comentarios).toEqual([
      { linea: 1, texto: " c " },
      { linea: 1, texto: " d" },
    ]);
  });

  it("las plantillas y las expresiones regulares se ven, pero no son código", () => {
    expect(lexico("a`b${c}d`e", "js").codigo).toBe("a    c   e");
    expect(lexico("a`b${c}d`e", "js").visible).toBe("a`b${c}d`e");
    expect(lexico("`a ${b} c`", "js").codigo).toBe("     b    ");
    expect(lexico("`a ${b} c`", "js").visible).toBe("`a ${b} c`");
    expect(lexico("x = /ab/g;", "js").visible).toBe("x = /ab/g;");
    expect(lexico("`a\\`b`", "js").visible).toBe("`a\\`b`");
    expect(lexico("`a\\`b`", "js").codigo).toBe(enBlanco("`a\\`b`"));
    expect(lexico("`a\nb`\nc", "js").codigo).toBe("  \n  \nc");
  });

  it("un comentario de bloque se parte por línea y cada línea trae su número", () => {
    const { comentarios, codigo } = lexico("a;\n/* uno\n dos\n tres */ b", "js");
    expect(comentarios).toEqual([
      { linea: 2, texto: " uno" },
      { linea: 3, texto: " dos" },
      { linea: 4, texto: " tres " },
    ]);
    expect(codigo).toBe("a;\n      \n    \n         b");
  });

  it("un comentario de bloque sin cerrar llega al final", () => {
    const { comentarios, codigo } = lexico("a /* x\ny", "js");
    expect(comentarios).toEqual([
      { linea: 1, texto: " x" },
      { linea: 2, texto: "y" },
    ]);
    expect(codigo).toBe("a     \n ");
  });

  it("la barra y el asterisco de apertura no cierran el comentario: `/*/` sigue abierto", () => {
    expect(vistos("a.ts", "/*/ TODO: x */\n")).toEqual(["todo@1"]);
    expect(lexico("/*/ x */ y", "js").codigo).toBe("         y");
    expect(lexico("/**/ y", "js").codigo).toBe("     y");
  });

  it("un comentario de línea pegado al código cuenta; la almohadilla pide un blanco antes", () => {
    expect(vistos("a.ts", "a;// TODO: x\n")).toEqual(["todo@1"]);
    expect(vistos("a.yml", "a# TODO: x\n")).toEqual([]);
    expect(vistos("a.yml", "a: b #TODO: x\n")).toEqual(["todo@1"]);
    expect(vistos("a.yml", "#TODO: x\n")).toEqual(["todo@1"]);
    expect(vistos("a.yml", "a:\t# TODO: x\n")).toEqual(["todo@1"]);
    expect(vistos("a.yml", "a: b\n# TODO: x\n")).toEqual(["todo@2"]);
  });

  it("el css no tiene comentarios de línea: un `null` en el texto no es un delimitador", () => {
    expect(vistos("a.css", "a { b: null }\n/* TODO: x */\n")).toEqual(["todo@2"]);
    expect(lexico("a { b: null }", "css").comentarios).toEqual([]);
  });
});

describe("las marcas se leen al principio del comentario", () => {
  it.each([
    "usar @ts-ignore aquí",
    "no usar @ts-expect-error",
    "el HACK de ayer",
    "un XXX en medio",
    "sin FIXME acá",
  ])("`%s` no es un marcador", (comentario) => {
    expect(tipoDeComentario(comentario)).toBeNull();
  });
});

describe("el BOM y los archivos de configuración", () => {
  it("un BOM al principio no impide leer el json", () => {
    const { marcadores: lista, ilegible } = detectar(
      "knip.json",
      '\uFEFF{\n  "ignore": ["a"]\n}\n',
    );
    expect(lista).toEqual([{ tipo: "knip-ignora", linea: 2 }]);
    expect(ilegible).toBeNull();
  });

  it("un BOM en medio del texto no se saca", () => {
    expect(vistos("a.ts", "// @ts-\uFEFFignore\n")).toEqual([]);
    expect(vistos("a.ts", "\uFEFF// @ts-ignore\n")).toEqual(["ts-ignore@1"]);
  });

  it("los marcadores salen ordenados por línea aunque se hallen en otro orden", () => {
    expect(vistos("a.ts", SALTADA_Y_DESPUES_UN_TODO)).toEqual(["prueba-saltada@1", "todo@2"]);
    expect(vistos("a.ts", TODOS_Y_SALTADAS_ENTREVERADOS)).toEqual([
      "todo@1",
      "todo@2",
      "prueba-saltada@3",
      "prueba-saltada@4",
      "todo@5",
    ]);
    expect(
      vistos("knip.json", '{\n  "ignore": ["a"],\n  // TODO: x\n  "ignoreBinaries": ["b"]\n}\n'),
    ).toEqual(["knip-ignora@2", "todo@3", "knip-ignora@4"]);
    expect(
      vistos("a.yml", "a: 1\ncontinue-on-error: true\n# TODO: x\nb:\n  continue-on-error: true\n"),
    ).toEqual(["continue-on-error@2", "todo@3", "continue-on-error@5"]);
  });

  it("`ignoreMembers` también cuenta", () => {
    expect(vistos("knip.json", '{\n  "ignoreMembers": ["a", "b"]\n}\n')).toEqual([
      "knip-ignora@2",
      "knip-ignora@2",
    ]);
  });

  it("las listas anidadas en una lista también se recorren", () => {
    expect(vistos("knip.json", '{\n  "x": [\n    { "ignore": ["a"] }\n  ]\n}\n')).toEqual([
      "knip-ignora@3",
    ]);
    expect(
      vistos("knip.json", '[\n  [\n    { "ignoreIssues": { "a.ts": ["x"] } }\n  ]\n]\n'),
    ).toEqual(["knip-ignora@3"]);
  });

  it("un grupo `null` en grupos-de-mutacion.json cuenta como grupo sin filtro", () => {
    expect(vistos("arquitectura/grupos-de-mutacion.json", "[\n  null\n]\n")).toEqual([
      "mutacion-sin-filtro@2",
    ]);
  });

  it("continue-on-error solo cuenta en un archivo .yml o .yaml", () => {
    expect(vistos("a.toml", "continue-on-error: true\n")).toEqual([]);
    expect(vistos("ci.yml/otro.toml", "continue-on-error: true\n")).toEqual([]);
    expect(vistos("a.yml", "continue-on-error: true\n")).toEqual(["continue-on-error@1"]);
    expect(vistos("a.yaml", "continue-on-error: true\n")).toEqual(["continue-on-error@1"]);
    expect(vistos("A.YML", "continue-on-error: true\n")).toEqual(["continue-on-error@1"]);
  });
});

/** Un archivo de código de `n` líneas, con salto final. */
const deLineas = (n: number): string =>
  lineas(...Array.from({ length: n }, (_, i) => `export const x${String(i)} = ${String(i)};`));
const OPCIONES = { topeDeLineas: 10, excluidos: new Set<string>() };

describe("cuántas líneas tiene un texto", () => {
  it.each([
    ["", 0],
    ["a", 1],
    ["a\n", 1],
    ["a\nb", 2],
    ["a\nb\n", 2],
    ["\n", 1],
    ["\n\n", 2],
    ["a\r\nb\r\n", 2],
    ["a\n\nb", 3],
  ])("%j tiene %i", (texto, cuantas) => {
    expect(tamano.lineasDe(texto)).toBe(cuantas);
  });
});

describe("tamanoExcedido: cuándo un archivo pasa del tope", () => {
  it("el tope de arranque es 400 y las opciones por omisión lo usan, sin exclusiones", () => {
    expect(tamano.TOPE_DE_LINEAS).toBe(400);
    expect(tamano.OPCIONES_POR_DEFECTO.topeDeLineas).toBe(400);
    expect(tamano.OPCIONES_POR_DEFECTO.excluidos.size).toBe(0);
  });

  it("justo en el tope no es deuda; una línea más sí, con la primera línea de más y el tamaño", () => {
    expect(tamano.tamanoExcedido("src/a.ts", deLineas(10), OPCIONES)).toBeNull();
    expect(tamano.tamanoExcedido("src/a.ts", deLineas(11), OPCIONES)).toEqual({
      linea: 11,
      tamano: 11,
    });
    expect(tamano.tamanoExcedido("src/a.ts", deLineas(40), OPCIONES)).toEqual({
      linea: 11,
      tamano: 40,
    });
    expect(tamano.tamanoExcedido("src/a.ts", `${deLineas(10)}x`, OPCIONES)).toEqual({
      linea: 11,
      tamano: 11,
    });
  });

  it.each([
    "src/a.ts",
    "src/carpeta/profunda/a.tsx",
    "src/a.mts",
    "src/a.cts",
    "src/a.js",
    "src/a.jsx",
    "src/a.mjs",
    "src/a.cjs",
    "src/a.d.ts",
    "apps/web/ui/a.tsx",
    "apps/plataforma/servidor/a.ts",
    "arquitectura/a.cjs",
    "arquitectura/contratos/a.cjs",
    "arquitectura/deuda/hondo/a.cjs",
    "src/a.test.ts/codigo.ts",
  ])("%s se mide", (ruta) => {
    expect(tamano.tamanoExcedido(ruta, deLineas(30), OPCIONES)).toEqual({ linea: 11, tamano: 30 });
  });

  it.each([
    "src/a.test.ts",
    "src/a.propiedades.test.ts",
    "src/a.test.tsx",
    "src/a.test.mts",
    "src/a.test.cjs",
    "test/a.ts",
    "test/integracion/a.test.ts",
    "test/arquitectura/guardian-apoyo.ts",
    "arquitectura/a.ts",
    "arquitectura/a.mjs",
    "arquitectura/contratos/a.json",
    "src/a.json",
    "src/a.sql",
    "src/a.css",
    "src/a.md",
    "src/a.txt",
    "src/a",
    "src/a.tsx.bak",
    "a.ts",
    "scripts/a.ts",
    "docs/a.ts",
    "node_modules/x/src/a.ts",
    "otra/src/a.ts",
    "xsrc/a.ts",
    "apps",
    "src",
  ])("%s no se mide", (ruta) => {
    expect(tamano.tamanoExcedido(ruta, deLineas(30), OPCIONES)).toBeNull();
  });

  it("una ruta excluida no se mide; las demás sí", () => {
    const opciones = { topeDeLineas: 10, excluidos: new Set(["src/datos.ts"]) };
    expect(tamano.tamanoExcedido("src/datos.ts", deLineas(30), opciones)).toBeNull();
    expect(tamano.tamanoExcedido("src/otro.ts", deLineas(30), opciones)).toEqual({
      linea: 11,
      tamano: 30,
    });
    expect(tamano.tamanoExcedido("src/datos.tsx", deLineas(30), opciones)).not.toBeNull();
  });
});

describe("detectar: el archivo grande como marcador", () => {
  it("es un marcador `archivo-grande` en la línea siguiente al tope, con el tamaño, entre los demás", () => {
    const texto = `// TODO: x\n${deLineas(20)}`;
    const { marcadores: lista } = detectar("src/a.ts", texto, OPCIONES);
    expect(lista).toEqual([
      { tipo: "todo", linea: 1 },
      { tipo: "archivo-grande", linea: 11, tamano: 21 },
    ]);
  });

  it("sin opciones usa el tope de 400 líneas", () => {
    expect(detectar("src/a.ts", deLineas(400)).marcadores).toEqual([]);
    expect(detectar("src/a.ts", deLineas(401)).marcadores).toEqual([
      { tipo: "archivo-grande", linea: 401, tamano: 401 },
    ]);
  });

  it("un archivo que no se analiza (extensión) no es grande aunque lo parezca", () => {
    expect(detectar("src/a.md", deLineas(600)).marcadores).toEqual([]);
    expect(detectar("src/a.png", deLineas(600)).marcadores).toEqual([]);
  });

  it("un archivo de datos sobre el tope no es código: no cuenta", () => {
    expect(detectar("src/a.json", deLineas(600)).marcadores).toEqual([]);
    expect(detectar("src/a.sql", deLineas(600)).marcadores).toEqual([]);
    expect(detectar("src/a.css", deLineas(600)).marcadores).toEqual([]);
  });

  it("el tamaño cuenta el archivo entero, con BOM y sin él", () => {
    expect(detectar("src/a.ts", `\uFEFF${deLineas(11)}`, OPCIONES).marcadores).toEqual([
      { tipo: "archivo-grande", linea: 11, tamano: 11 },
    ]);
  });
});
