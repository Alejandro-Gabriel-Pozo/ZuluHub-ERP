import { describe, expect, it } from "vitest";
import {
  contarProhibidosEnCodigo,
  contarProhibidosEnSql,
  esPatronDeProhibicion,
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
    expect(esPatronDeProhibicion("\\p{Zs}")).toBe(false);
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
