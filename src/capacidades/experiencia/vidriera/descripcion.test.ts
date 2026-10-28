import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../../test/propiedades/configuracion";
import {
  LARGO_MAXIMO_DE_LA_DESCRIPCION,
  SALTOS_MAXIMOS_DE_LA_DESCRIPCION,
  validarDescripcionDeProducto,
} from "./descripcion";

const ok = (valor: string | null) => ({ ok: true, valor });
const err = (error: string) => ({ ok: false, error });

describe("validarDescripcionDeProducto (§3.1 y §3.6)", () => {
  it("los límites son 300 caracteres y 2 saltos", () => {
    expect(LARGO_MAXIMO_DE_LA_DESCRIPCION).toBe(300);
    expect(SALTOS_MAXIMOS_DE_LA_DESCRIPCION).toBe(2);
  });

  it("es opcional: vacía o en blanco = sin descripción", () => {
    for (const t of ["", "   ", "\n", " \n \n\n ", "\r\n"]) {
      expect(validarDescripcionDeProducto(t), JSON.stringify(t)).toEqual(ok(null));
    }
  });

  it("acepta texto plano y lo devuelve recortado", () => {
    expect(validarDescripcionDeProducto("  Espresso, leche espumada y cacao amargo.  ")).toEqual(
      ok("Espresso, leche espumada y cacao amargo."),
    );
  });

  it("acepta tildes, ñ y emojis simples", () => {
    expect(validarDescripcionDeProducto("Ñoquis de calabaza con salsa de champiñón 🍝")).toEqual(
      ok("Ñoquis de calabaza con salsa de champiñón 🍝"),
    );
  });

  it("deja el texto en NFC", () => {
    const nfd = "Café con leche";
    expect(validarDescripcionDeProducto(nfd)).toEqual(ok("Café con leche"));
  });

  describe("largo (en puntos de código, como la base)", () => {
    it("300 sí, 301 no", () => {
      expect(validarDescripcionDeProducto("a".repeat(300))).toEqual(ok("a".repeat(300)));
      expect(validarDescripcionDeProducto("a".repeat(301))).toEqual(err("DEMASIADO_LARGA"));
    });

    it("un emoji (dos unidades UTF-16) cuenta como un carácter", () => {
      expect(validarDescripcionDeProducto("🍕".repeat(300))).toEqual(ok("🍕".repeat(300)));
      expect(validarDescripcionDeProducto("🍕".repeat(301))).toEqual(err("DEMASIADO_LARGA"));
    });

    it("se mide después de recortar y de normalizar", () => {
      expect(validarDescripcionDeProducto(`  ${"a".repeat(300)}  `)).toEqual(ok("a".repeat(300)));
      expect(validarDescripcionDeProducto("é".repeat(300))).toEqual(ok("é".repeat(300)));
    });

    it("los saltos de línea cuentan como caracteres", () => {
      const justo = `${"a".repeat(149)}\n${"b".repeat(150)}`;
      expect(justo).toHaveLength(300);
      expect(validarDescripcionDeProducto(justo)).toEqual(ok(justo));
      expect(validarDescripcionDeProducto(`${justo}c`)).toEqual(err("DEMASIADO_LARGA"));
    });
  });

  describe("saltos de línea (hasta 2)", () => {
    it("0, 1 y 2 saltos pasan", () => {
      expect(validarDescripcionDeProducto("a")).toEqual(ok("a"));
      expect(validarDescripcionDeProducto("a\nb")).toEqual(ok("a\nb"));
      expect(validarDescripcionDeProducto("a\nb\nc")).toEqual(ok("a\nb\nc"));
      expect(validarDescripcionDeProducto("a\n\nb")).toEqual(ok("a\n\nb"));
    });

    it("3 saltos no", () => {
      expect(validarDescripcionDeProducto("a\nb\nc\nd")).toEqual(err("DEMASIADOS_SALTOS_DE_LINEA"));
      expect(validarDescripcionDeProducto("a\n\n\nb")).toEqual(err("DEMASIADOS_SALTOS_DE_LINEA"));
    });

    it("los saltos de los extremos no cuentan: se recortan", () => {
      expect(validarDescripcionDeProducto("\n\na\nb\nc\n\n")).toEqual(ok("a\nb\nc"));
    });

    it("un \\r\\n (de un formulario) vale un salto y queda como \\n", () => {
      expect(validarDescripcionDeProducto("a\r\nb\r\nc")).toEqual(ok("a\nb\nc"));
      expect(validarDescripcionDeProducto("a\r\nb\r\nc\r\nd")).toEqual(
        err("DEMASIADOS_SALTOS_DE_LINEA"),
      );
    });

    it("un \\r suelto es un carácter de control", () => {
      expect(validarDescripcionDeProducto("a\rb")).toEqual(err("CARACTER_PROHIBIDO"));
    });
  });

  describe("caracteres prohibidos", () => {
    it.each([
      ["<b>negrita</b>", "marcado HTML"],
      ["a > b", "mayor"],
      ["a < b", "menor"],
      ["a\u0000b", "nulo"],
      ["a\tb", "tabulación"],
      ["a\u001bb", "escape"],
      ["a\u007fb", "DEL"],
      ["a\u0085b", "NEL"],
      ["a​b", "ancho cero"],
      ["a‮b", "inversión de dirección"],
      ["a­b", "guion blando"],
      ["a\ud800b", "sustituto suelto"],
    ])("%j (%s) no pasa", (texto) => {
      expect(validarDescripcionDeProducto(texto)).toEqual(err("CARACTER_PROHIBIDO"));
    });

    it("se mira el texto tal cual llega: un prohibido al final no se pierde al recortar", () => {
      expect(validarDescripcionDeProducto("hola\t")).toEqual(err("CARACTER_PROHIBIDO"));
      expect(validarDescripcionDeProducto("\u0000")).toEqual(err("CARACTER_PROHIBIDO"));
    });

    it("el carácter prohibido gana sobre el largo y los saltos", () => {
      expect(validarDescripcionDeProducto(`${"a".repeat(400)}<`)).toEqual(
        err("CARACTER_PROHIBIDO"),
      );
      expect(validarDescripcionDeProducto("a\nb\nc\nd<")).toEqual(err("CARACTER_PROHIBIDO"));
    });

    it("el largo gana sobre los saltos", () => {
      expect(validarDescripcionDeProducto(`${"a".repeat(150)}\n\n\n${"b".repeat(150)}`)).toEqual(
        err("DEMASIADO_LARGA"),
      );
    });

    it("Markdown no se interpreta ni se rechaza: es texto", () => {
      expect(validarDescripcionDeProducto("**fuerte** y _suave_ [enlace](x)")).toEqual(
        ok("**fuerte** y _suave_ [enlace](x)"),
      );
    });
  });

  describe("propiedades", () => {
    const cualquiera = fc.oneof(
      fc.string({ maxLength: 400 }),
      fc.string({ unit: "binary", maxLength: 400 }),
    );

    it("nunca lanza y, si es válida, cumple todas las reglas", () => {
      fc.assert(
        fc.property(cualquiera, (texto) => {
          const r = validarDescripcionDeProducto(texto);
          if (!r.ok || r.valor === null) return;
          expect([...r.valor].length).toBeLessThanOrEqual(300);
          expect(r.valor.split("\n").length - 1).toBeLessThanOrEqual(2);
          expect(r.valor.replaceAll("\n", "")).not.toMatch(/[\p{Cc}\p{Cf}\p{Cs}<>]/u);
          expect(r.valor).toBe(r.valor.trim());
          expect(r.valor).toBe(r.valor.normalize("NFC"));
        }),
      );
    });

    it("es idempotente: validar lo ya validado no cambia nada", () => {
      fc.assert(
        fc.property(cualquiera, (texto) => {
          const r = validarDescripcionDeProducto(texto);
          if (r.ok && r.valor !== null) expect(validarDescripcionDeProducto(r.valor)).toEqual(r);
        }),
      );
    });

    it("todo texto con < o > se rechaza", () => {
      fc.assert(
        fc.property(
          fc.string({ maxLength: 50 }),
          fc.constantFrom("<", ">"),
          fc.string({ maxLength: 50 }),
          (a, c, b) => {
            expect(validarDescripcionDeProducto(`${a}${c}${b}`)).toEqual(err("CARACTER_PROHIBIDO"));
          },
        ),
      );
    });
  });
});
