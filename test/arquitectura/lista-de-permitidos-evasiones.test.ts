import { describe, expect, it } from "vitest";
import {
  contarProhibidosEnCodigo,
  contarProhibidosEnSql,
  esPatronDeProhibicion,
  problemasDeExenciones,
} from "./lista-de-permitidos-apoyo";

/**
 * Violaciones inyectadas de `lista-de-permitidos.test.ts`: cada forma de validar por lista de prohibidos tiene su caso. Si se debilita
 * el analizador (`lista-de-permitidos-apoyo.ts`), el caso correspondiente deja de contar y esta prueba se pone roja. Y lo permitido
 * (la lista de lo que SÍ vale, reemplazar o separar) no cuenta.
 */

const cuenta = (texto: string) => contarProhibidosEnCodigo("x.ts", texto);

describe("lista de permitidos: cada forma de prohibir se cuenta", () => {
  it.each([
    ["controles por categoría", "export const ok = (t: string) => !/\\p{Cc}/u.test(t);"],
    [
      "invisibles por categoría",
      "export const ok = (t: string) => !/[\\p{C}\\p{Zl}\\p{Zp}]/u.test(t);",
    ],
    [
      "controles por rango hexadecimal",
      "export const ok = (t: string) => !/[\\x00-\\x1f]/.test(t);",
    ],
    [
      "controles por rango unicode",
      "export const ok = (t: string) => !/[\\u0000-\\u001f\\u007f]/.test(t);",
    ],
    ["marcado en una clase", "export const ok = (t: string) => !/[<>]/.test(t);"],
    ["clase negada con espacio", "export const ok = (t: string) => /^[^\\s]+$/.test(t);"],
    ["clase negada con arroba", "export const ok = (t: string) => /^[^@]+$/.test(t);"],
    ["clase negada con comillas", 'export const ok = (t: string) => /^[^"]+$/.test(t);'],
    [
      "guardada en una constante",
      "const MALO = /\\p{Cc}/u;\nexport const ok = (t: string) => !MALO.test(t);",
    ],
    ["constante exportada sin uso local", "export const MALO = /\\p{Cc}/u;"],
    ["con búsqueda", "export const ok = (t: string) => t.search(/\\p{Cc}/u) < 0;"],
    ["con coincidencia", "export const ok = (t: string) => t.match(/\\p{Cc}/u) === null;"],
    [
      "constructor con cadena",
      'export const ok = (t: string) => !new RegExp("\\\\p{Cc}", "u").test(t);',
    ],
    [
      "constructor con plantilla",
      "export const ok = (t: string) => !new RegExp(`[\\\\p{C}${'x'}]`, 'u').test(t);",
    ],
    [
      "constructor con cadena sumada",
      'export const ok = (t: string) => !new RegExp("[<" + ">]").test(t);',
    ],
    [
      "constante usada para validar y para reemplazar",
      "const R = /\\p{Cc}/gu;\nexport const a = (t: string) => R.test(t);\nexport const b = (t: string) => t.replace(R, '');",
    ],
  ])("%s", (_, texto) => {
    expect(cuenta(texto)).toBe(1);
  });

  it("cuenta cada una por separado", () => {
    expect(cuenta("export const a = /\\p{Cc}/u;\nexport const b = /[<>]/;")).toBe(2);
  });
});

describe("lista de permitidos: lo que declara lo permitido no se cuenta", () => {
  it.each([
    ["la lista de permitidos", "export const ok = (t: string) => /^[A-Za-z0-9 ]{1,40}$/.test(t);"],
    [
      "una clase negada solo de letras y dígitos (el reverso de una lista de permitidos)",
      "export const ok = (t: string) => !/[^a-z0-9]/.test(t);",
    ],
    ["reemplazar", "export const f = (t: string) => t.replace(/\\p{Cc}/gu, '');"],
    ["reemplazar todo", "export const f = (t: string) => t.replaceAll(/[<>]/g, '');"],
    ["separar", "export const f = (t: string) => t.split(/[<>]/);"],
    [
      "una constante que solo reemplaza",
      "const R = /[<>]/g;\nexport const f = (t: string) => t.replace(R, '');",
    ],
    [
      "un constructor armado con constantes",
      "const PERMITIDOS = 'a-z';\nexport const R = new RegExp(`^[${PERMITIDOS}]+$`);",
    ],
    [
      "espacios Unicode normalizados",
      "export const f = (t: string) => t.replace(/\\p{Zs}+/gu, ' ');",
    ],
    ["un texto sin expresiones regulares", "export const x = 'hola';"],
  ])("%s", (_, texto) => {
    expect(cuenta(texto)).toBe(0);
  });

  it("el patrón de prohibición se decide solo por lo que describe", () => {
    expect(esPatronDeProhibicion("^[a-z]+$")).toBe(false);
    expect(esPatronDeProhibicion("\\p{Cc}")).toBe(true);
    expect(esPatronDeProhibicion("\\p{Zs}")).toBe(true);
    expect(esPatronDeProhibicion("[\\s\\S]*")).toBe(false);
    expect(esPatronDeProhibicion("[\\w$\\u0080-\\uffff]")).toBe(false);
    expect(esPatronDeProhibicion("[^!-~]")).toBe(false);
  });
});

describe("lista de permitidos: migraciones SQL", () => {
  it("cuenta cada «no coincide con controles», aunque haya varias en un archivo", () => {
    expect(contarProhibidosEnSql("CHECK (a !~ '[\\x01-\\x1F\\x7F-\\x9F]')")).toBe(1);
    expect(
      contarProhibidosEnSql(
        "CHECK (a !~ '[\\x01-\\x1F]' AND b !~ '[\\x01-\\x1F\\x7F-\\x9F]' AND c !~   '[\\x01-\\x1F]')",
      ),
    ).toBe(3);
  });

  it("no cuenta la lista de permitidos ni el recorte de espacios", () => {
    expect(contarProhibidosEnSql("CHECK (a ~ '^[A-Za-z0-9._~-]{1,200}$')")).toBe(0);
    expect(contarProhibidosEnSql("CHECK (a !~ '^[A-Za-z0-9._~-]{1,200}$')")).toBe(0);
    expect(contarProhibidosEnSql("CHECK (a !~ '^\\s|\\s$')")).toBe(0);
  });
});

describe("lista de permitidos: las formas que la revisión independiente pidió cerrar (PR 2 de C1)", () => {
  const r = String.raw;
  it.each([
    ["includes contra <", r`export const f = (t: string) => !t.includes("<");`],
    ["includes contra >", r`export const f = (t: string) => !t.includes('>');`],
    ["includes contra un salto de línea", r`export const f = (t: string) => !t.includes("\n");`],
    ["includes contra un invisible", r`export const f = (t: string) => !t.includes("\u200b");`],
    ["indexOf contra <", r`export const f = (t: string) => t.indexOf("<") < 0;`],
    ["startsWith contra un control", r`export const f = (t: string) => !t.startsWith("\u0000");`],
    ["comparación con <", r`export const f = (c: string) => c !== "<";`],
    ["comparación con >", r`export const f = (c: string) => c === ">";`],
    ["charCodeAt contra un control", r`export const f = (t: string) => t.charCodeAt(0) < 32;`],
    ["codePointAt contra DEL", r`export const f = (t: string) => t.codePointAt(0) === 127;`],
    [
      "codePointAt contra un invisible",
      r`export const f = (t: string) => t.codePointAt(0) === 0x200b;`,
    ],
    ["codePointAt contra <", r`export const f = (t: string) => 60 === t.codePointAt(0);`],
    ["RegExp sin new", r`export const R = RegExp(variable);`],
    ["new RegExp sin texto fijo", r`export const R = new RegExp(variable, "u");`],
    ["RegExp por globalThis", r`export const R = new globalThis.RegExp(variable);`],
    ["RegExp sin argumento", r`export const R = new RegExp();`],
    ["alias de RegExp", r`const R = RegExp;` + "\n" + r`export const x = new R(variable);`],
    ["RegExp pasado como argumento", r`export const x = construir(RegExp);`],
    ["RegExp por globalThis sin llamar", r`export const R = globalThis.RegExp;`],
    ["clase negada de comas", r`export const ok = (t: string) => /[^,;]/.test(t);`],
    ["clase negada de saltos de línea", r`export const ok = (t: string) => /^[^\r\n]+$/.test(t);`],
    ["todo menos espacios", r`export const ok = (t: string) => /^\S+$/.test(t);`],
    ["separadores", r`export const ok = (t: string) => /\p{Z}/u.test(t);`],
    ["controles de 0x80 a 0x9f", r`export const ok = (t: string) => /[\x80-\x9f]/.test(t);`],
    ["invisibles con escape", r`export const ok = (t: string) => /[\u200b-\u200f]/.test(t);`],
    [
      "invisibles con el carácter mismo",
      "export const ok = (t: string) => /[\u200b\u200c]/.test(t);",
    ],
    ["espacio de no separación", r`export const ok = (t: string) => /\u00ad/.test(t);`],
    ["marca de orden de bytes", r`export const ok = (t: string) => /\ufeff/.test(t);`],
    [
      "separador de línea",
      "export const ok = (t: string) => /" + String.fromCharCode(92) + "u2028/.test(t);",
    ],
    ["constructor con clase negada", r`export const R = new RegExp("[^,;]");`],
  ])("%s", (_, texto) => {
    expect(cuenta(texto), texto).toBe(1);
  });

  it("no cuenta una búsqueda con posición ni un código que no es de control", () => {
    expect(cuenta(r`export const f = (s: string, i: number) => s.indexOf("\n", i);`)).toBe(0);
    expect(cuenta(r`export const f = (t: string) => (t.codePointAt(0) ?? 0) % 360;`)).toBe(0);
    expect(cuenta(r`export const f = (t: string) => t.charCodeAt(0) === 65;`)).toBe(0);
    expect(cuenta(r`export const f = (t: string) => t.includes("<svg");`)).toBe(0);
    expect(cuenta(r`export const f = (t: unknown) => t instanceof RegExp;`)).toBe(0);
    expect(cuenta(r`export const f = (t: RegExp) => t;`)).toBe(0);
    expect(cuenta(r`export const f = (t: string) => /[\s\S]+/.exec(t);`)).toBe(0);
    expect(cuenta(r`export const f = (t: string) => /[\w$\u0080-￿]/.test(t);`)).toBe(0);
    expect(cuenta(r`export const f = (t: string) => /[^!-~]/.test(t);`)).toBe(0);
    expect(cuenta("export const R = new RegExp(String.raw`^[${PERMITIDOS}]+$`);")).toBe(0);
  });
});

describe("lista de permitidos: SQL fail-closed (migración 0007, !~*, NOT, E'…')", () => {
  const sql = contarProhibidosEnSql;
  const r = String.raw;

  it("cuenta la lista de prohibidos armada con || entre paréntesis (texto_visible_valido)", () => {
    const funcion = [
      r`t !~ ('[\x01-\x1f\x7f-\x9f<>'`,
      r`      || '\u00ad\u0600-\u0605\u200b-\u200f]')`,
      r`AND t !~ '^[ \u00a0\u1680\u2000-\u200a]'`,
      r`AND t !~ '[ \u00a0\u1680\u2000-\u200a]$'`,
    ].join("\n");
    expect(sql(funcion)).toBe(3);
  });

  it.each([
    ["!~ con <>", r`CHECK (a !~ '[<>]')`],
    ["!~* con <>", r`CHECK (a !~* '[<>]')`],
    ["!~ con una clase negada abierta", r`CHECK (a !~ '^[^,;]*$')`],
    ["!~ con E'…'", r`CHECK (a !~ E'[\x01-\x1f]')`],
    ["!~ con una expresión que no es cadena", r`CHECK (a !~ patron_prohibido())`],
    ["!~ con una columna", r`CHECK (a !~ otra_columna)`],
    ["NOT (x ~ …)", r`CHECK (NOT (a ~ '[<>]'))`],
    ["NOT (x ~* …)", r`CHECK (NOT (a ~* '[<>]'))`],
    ["NOT LIKE", r`CHECK (a NOT LIKE '%<%')`],
    ["NOT ILIKE", r`CHECK (a NOT ILIKE '%<%')`],
    ["NOT SIMILAR TO", r`CHECK (a NOT SIMILAR TO '%(<|>)%')`],
    ["escape unicode", r`CHECK (a !~ '[\u200b]')`],
  ])("%s", (_, texto) => {
    expect(sql(texto), texto).toBe(1);
  });

  it("no cuenta lo permitido, el recorte de espacios ni los comentarios", () => {
    expect(sql(r`CHECK (a ~ '[<>]')`)).toBe(0);
    expect(sql(r`CHECK (a !~ '^[0-9]{11}$')`)).toBe(0);
    expect(sql(r`CHECK (a !~ '^\s|\s$')`)).toBe(0);
    expect(sql(r`CHECK (a IS NOT NULL AND b NOT BETWEEN 1 AND 3)`)).toBe(0);
    expect(sql("-- a !~ '[<>]' en un comentario\nSELECT 1;")).toBe(0);
  });
});

describe("lista de permitidos: segunda revisión independiente (O1 a O6, PR 2 de C1)", () => {
  const r = String.raw;

  it.each([
    [
      "String.raw con una categoría",
      r`export const R = new RegExp(String.raw` + "`" + r`\p{Cc}` + "`" + r`, "u");`,
    ],
    [
      "String.raw con un rango de controles",
      r`export const R = new RegExp(String.raw` + "`" + r`[\x00-\x1f]` + "`" + r`);`,
    ],
    [
      "String.raw con una parte variable",
      r`export const R = new RegExp(String.raw` + "`" + r`[\p{Cc}$` + "{x}]" + "`" + r`);`,
    ],
    ["globalThis con corchetes", r`export const R = globalThis["RegExp"]("a");`],
    ["categoría con nombre largo", r`export const R = /\p{General_Category=Control}/u;`],
    ["categoría abreviada con gc", r`export const R = /\p{gc=Cc}/u;`],
    ["categoría White_Space", r`export const R = /\p{White_Space}/u;`],
    ["categoría Control", r`export const R = /\p{Control}/u;`],
    ["escape con llaves", r`export const R = /\u{1f600}/u;`],
    ["clase con \r\n\t", r`export const R = /[\r\n\t]/;`],
    ["clase con \0", r`export const R = /[\0-\37]/;`],
    ["clase con un escape de control con c", r`export const R = /[\cA-\cZ]/;`],
  ])("%s cuenta", (_, texto) => {
    expect(cuenta(texto), texto).toBe(1);
  });

  it("String.raw con solo lo permitido no cuenta", () => {
    expect(cuenta("export const R = new RegExp(String.raw`^[a-z]{1,40}$`);")).toBe(0);
    expect(cuenta(r`export const R = /\p{Script=Latin}+/u;`)).toBe(0);
    expect(cuenta(r`export const R = /\p{L}+/u;`)).toBe(0);
  });

  it("los usos de texto_visible_valido y texto_fiscal_valido cuentan; la definición y la baja, no", () => {
    expect(contarProhibidosEnSql("CHECK (texto_visible_valido(nombre, 60))")).toBe(1);
    expect(
      contarProhibidosEnSql("CHECK (texto_fiscal_valido(a, 10) AND texto_fiscal_valido(b, 20))"),
    ).toBe(2);
    expect(
      contarProhibidosEnSql("CHECK (nombre IS NULL OR TEXTO_FISCAL_VALIDO (nombre, 20))"),
    ).toBe(1);
    expect(
      contarProhibidosEnSql(
        "CREATE FUNCTION texto_visible_valido(t text, p integer) RETURNS boolean AS $$ SELECT true $$;",
      ),
    ).toBe(0);
    expect(
      contarProhibidosEnSql(
        "CREATE OR REPLACE FUNCTION texto_fiscal_valido(t text, p integer) RETURNS boolean AS $$ SELECT true $$;",
      ),
    ).toBe(0);
    expect(contarProhibidosEnSql("DROP FUNCTION texto_visible_valido(text, integer);")).toBe(0);
    expect(
      contarProhibidosEnSql("DROP FUNCTION IF EXISTS texto_fiscal_valido(text, integer);"),
    ).toBe(0);
    expect(contarProhibidosEnSql("-- texto_visible_valido(a, 1) en un comentario\nSELECT 1;")).toBe(
      0,
    );
    expect(contarProhibidosEnSql("CHECK (otra_funcion(nombre, 60))")).toBe(0);
  });
});

describe("lista de permitidos: las exenciones por formato de terceros no se ciegan (O1 y O2)", () => {
  const exenciones = {
    "src/a.ts": { motivo: "formato de un tercero", prohibidos: 1 },
    "src/b.ts": { motivo: "otro formato", prohibidos: 2 },
  };
  const esperadas = ["src/a.ts", "src/b.ts"];
  const cuentas: Record<string, number> = { "src/a.ts": 1, "src/b.ts": 2 };
  const problemas = (
    ex: Record<string, { motivo: string; prohibidos: number }> = exenciones,
    esp: readonly string[] = esperadas,
    real: Record<string, number> = cuentas,
    presupuesto: Record<string, unknown> = {},
  ) => problemasDeExenciones(ex, esp, (ruta) => real[ruta] ?? 0, presupuesto);

  it("lo exacto no tiene problemas", () => {
    expect(problemas()).toEqual([]);
  });

  it("una prohibición nueva en un archivo eximido obliga a tocar la prueba", () => {
    expect(problemas(exenciones, esperadas, { ...cuentas, "src/a.ts": 2 })).toEqual([
      "src/a.ts: tiene 2 prohibiciones y la exención declara 1",
    ]);
    expect(problemas(exenciones, esperadas, { ...cuentas, "src/b.ts": 0 })).toEqual([
      "src/b.ts: tiene 0 prohibiciones y la exención declara 2",
    ]);
  });

  it("un tercer archivo eximido, o uno que falta, obliga a tocar la lista exacta", () => {
    const tres = { ...exenciones, "src/c.ts": { motivo: "otro más", prohibidos: 0 } };
    expect(problemas(tres)).toEqual([
      "las exenciones son src/a.ts, src/b.ts, src/c.ts y tienen que ser exactamente src/a.ts, src/b.ts",
    ]);
    expect(problemas({ "src/a.ts": exenciones["src/a.ts"] })).toEqual([
      "las exenciones son src/a.ts y tienen que ser exactamente src/a.ts, src/b.ts",
    ]);
  });

  it("una exención sin motivo, o a la vez en el presupuesto, es un problema", () => {
    expect(problemas({ ...exenciones, "src/a.ts": { motivo: "  ", prohibidos: 1 } })).toEqual([
      "src/a.ts: la exención no tiene motivo",
    ]);
    expect(problemas(exenciones, esperadas, cuentas, { "src/b.ts": { prohibidos: 2 } })).toEqual([
      "src/b.ts: está eximido y también en el presupuesto de deuda",
    ]);
  });
});

describe("lista de permitidos: tercera revisión independiente (evasiones baratas cerradas)", () => {
  const r = String.raw;

  it.each([
    ["< escapado en hexadecimal", r`export const R = /[\x3c\x3e]/;`],
    ["< escapado en unicode", "export const R = /" + String.fromCharCode(92) + "u003c/;"],
    ["todo menos letras y dígitos", r`export const R = /^\W+$/;`],
    ["caracteres ignorables", r`export const R = /\p{Default_Ignorable_Code_Point}/u;`],
    ["globalThis con una clave calculada", r`export const R = globalThis[nombre]("a");`],
    ["window con una clave calculada", r`export const R = window[nombre];`],
    ["global con una clave calculada", r`export const R = global[nombre];`],
    [
      "globalThis convertido de tipo con una clave calculada",
      r`export const R = (globalThis as unknown as Record<string, unknown>)[nombre];`,
    ],
    [
      "Reflect.get sobre globalThis con RegExp",
      r`export const R = Reflect.get(globalThis, "RegExp");`,
    ],
    [
      "Reflect.get sobre globalThis con una clave calculada",
      r`export const R = Reflect.get(globalThis, nombre);`,
    ],
  ])("%s cuenta", (_, texto) => {
    expect(cuenta(texto), texto).toBe(1);
  });

  it("globalThis con una clave literal que no es RegExp no cuenta", () => {
    expect(cuenta(r`export const t = globalThis["setTimeout"];`)).toBe(0);
    expect(cuenta(r`export const t = Reflect.get(globalThis, "setTimeout");`)).toBe(0);
    expect(cuenta(r`export const t = Reflect.get(objeto, "RegExp");`)).toBe(0);
  });

  it.each([
    ["NOT x ~ sin paréntesis", r`CHECK (NOT a ~ '[<>]')`],
    ["NOT x ~* sin paréntesis", r`CHECK (NOT a.b ~* '[<>]')`],
    ["NOT x::text ~ sin paréntesis", r`CHECK (NOT a::text ~ '[<>]')`],
    ["< escapado en hexadecimal", r`CHECK (a !~ '[\x3c]')`],
    ["NOT (f(x) ~ …) con una función adentro", r`CHECK (NOT (lower(a) ~ '[<>]'))`],
    ["NOT f(x) ~ … con una función y sin paréntesis", r`CHECK (NOT btrim(a) ~ '[<>]')`],
  ])("SQL: %s cuenta", (_, texto) => {
    expect(contarProhibidosEnSql(texto), texto).toBe(1);
  });

  it("SQL: el uso de la función con el nombre entre comillas cuenta", () => {
    expect(contarProhibidosEnSql(r`CHECK ("texto_visible_valido"(nombre, 60))`)).toBe(1);
    expect(contarProhibidosEnSql(r`CHECK (NOT a ~ '^[0-9]+$')`)).toBe(0);
    expect(contarProhibidosEnSql(r`CHECK (NOT (lower(a) ~ '^[0-9]+$'))`)).toBe(0);
    expect(contarProhibidosEnSql(r`CHECK (NOT btrim(a) ~ '^[0-9]+$')`)).toBe(0);
  });

  it("SQL: crear o borrar la función con el nombre entre comillas no cuenta como un uso", () => {
    expect(
      contarProhibidosEnSql(r`DROP FUNCTION IF EXISTS "texto_visible_valido"(text, integer);`),
    ).toBe(0);
    expect(contarProhibidosEnSql(r`DROP FUNCTION "texto_fiscal_valido"(text, integer);`)).toBe(0);
    expect(
      contarProhibidosEnSql(
        r`CREATE OR REPLACE FUNCTION "texto_visible_valido"(t text, p integer) RETURNS boolean AS $$ SELECT true $$;`,
      ),
    ).toBe(0);
  });
});
