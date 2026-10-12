import { describe, expect, it } from "vitest";
import {
  LARGO_MAXIMO_DE_FILTRO,
  LIMITE_MAXIMO_DE_PAGINA,
  LIMITE_POR_DEFECTO_DE_PAGINA,
  claveDeIdempotenciaValida,
  filtroDeTexto,
  paginaValida,
  rangoDeFechas,
  resultadoDePagina,
  uuidDesdeTexto,
} from "./consulta";

const UUID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

describe("uuidDesdeTexto", () => {
  it("acepta un uuid canónico y lo devuelve en minúsculas", () => {
    expect(uuidDesdeTexto(UUID)).toEqual({ ok: true, valor: UUID });
    expect(uuidDesdeTexto(UUID.toUpperCase())).toEqual({ ok: true, valor: UUID });
    expect(uuidDesdeTexto("ABCDEF01-2345-6789-abcd-ef0123456789")).toEqual({
      ok: true,
      valor: "abcdef01-2345-6789-abcd-ef0123456789",
    });
  });

  it.each([
    ["vacío", ""],
    ["sin guiones", UUID.replaceAll("-", "")],
    ["con llaves", `{${UUID}}`],
    ["con texto antes", `x${UUID}`],
    ["con texto después", `${UUID}x`],
    ["con un salto de línea al final", `${UUID}\n`],
    ["con espacios", ` ${UUID} `],
    ["un dígito de menos", UUID.slice(1)],
    ["un dígito de más", `0${UUID}`],
    ["un grupo corto", "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4"],
    ["un grupo largo", "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d5"],
    ["un carácter que no es hexadecimal", "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4g"],
    ["los guiones corridos", "0a1b2c3d4-e5f-4a6b-8c7d-9e0f1a2b3c4d"],
    ["un id de prueba", "e-1"],
  ])("rechaza %s", (_nombre, texto) => {
    expect(uuidDesdeTexto(texto)).toEqual({ ok: false, error: "ID_INVALIDO" });
  });

  it("rechaza cada grupo con un carácter que no es hexadecimal", () => {
    for (const posicion of [0, 9, 14, 19, 24, 35]) {
      const roto = `${UUID.slice(0, posicion)}z${UUID.slice(posicion + 1)}`;
      expect(uuidDesdeTexto(roto), roto).toEqual({ ok: false, error: "ID_INVALIDO" });
    }
  });
});

describe("paginaValida", () => {
  it("sin nada pide la página por defecto, desde el principio", () => {
    expect(LIMITE_POR_DEFECTO_DE_PAGINA).toBe(50);
    expect(LIMITE_MAXIMO_DE_PAGINA).toBe(100);
    for (const cursor of ["UUID", "ENTERO"] as const) {
      expect(paginaValida({}, cursor)).toEqual({
        ok: true,
        valor: { limite: 50, despuesDeId: null },
      });
    }
  });

  it("acepta los límites de 1 a 100 y rechaza los de afuera", () => {
    for (const limite of [1, 2, 50, 99, 100]) {
      expect(paginaValida({ limite }, "UUID")).toEqual({
        ok: true,
        valor: { limite, despuesDeId: null },
      });
    }
    for (const limite of [0, -1, 101, 1000, 1.5, 50.0001, Number.NaN, Infinity, -Infinity]) {
      expect(paginaValida({ limite }, "UUID"), String(limite)).toEqual({
        ok: false,
        error: "LIMITE_INVALIDO",
      });
    }
  });

  it("un cursor uuid se normaliza a minúsculas; uno mal formado es CURSOR_INVALIDO", () => {
    expect(paginaValida({ despuesDeId: UUID.toUpperCase(), limite: 10 }, "UUID")).toEqual({
      ok: true,
      valor: { limite: 10, despuesDeId: UUID },
    });
    for (const malo of ["", "123", "no-es-un-id", `${UUID}x`]) {
      expect(paginaValida({ despuesDeId: malo }, "UUID"), malo).toEqual({
        ok: false,
        error: "CURSOR_INVALIDO",
      });
    }
  });

  it("un cursor entero acepta hasta 18 dígitos y nada más", () => {
    for (const bueno of ["0", "7", "42", "000123", "123456789012345678"]) {
      expect(paginaValida({ despuesDeId: bueno }, "ENTERO"), bueno).toEqual({
        ok: true,
        valor: { limite: 50, despuesDeId: bueno },
      });
    }
    for (const malo of [
      "",
      " 1",
      "1 ",
      "-1",
      "+1",
      "1.5",
      "1e3",
      "0x10",
      "12a",
      "a12",
      "1234567890123456789",
      "1\n",
      UUID,
    ]) {
      expect(paginaValida({ despuesDeId: malo }, "ENTERO"), malo).toEqual({
        ok: false,
        error: "CURSOR_INVALIDO",
      });
    }
  });

  it("el tipo de cursor importa: un entero no es un cursor uuid ni al revés", () => {
    expect(paginaValida({ despuesDeId: "123" }, "UUID")).toEqual({
      ok: false,
      error: "CURSOR_INVALIDO",
    });
    expect(paginaValida({ despuesDeId: UUID }, "ENTERO")).toEqual({
      ok: false,
      error: "CURSOR_INVALIDO",
    });
  });

  it("el límite se mira antes que el cursor", () => {
    expect(paginaValida({ limite: 0, despuesDeId: "mal" }, "UUID")).toEqual({
      ok: false,
      error: "LIMITE_INVALIDO",
    });
    expect(paginaValida({ limite: 5, despuesDeId: "mal" }, "UUID")).toEqual({
      ok: false,
      error: "CURSOR_INVALIDO",
    });
  });
});

describe("claveDeIdempotenciaValida", () => {
  it("de 16 a 128 letras, números, guion y guion bajo", () => {
    expect(claveDeIdempotenciaValida("a".repeat(16))).toBe(true);
    expect(claveDeIdempotenciaValida("a".repeat(128))).toBe(true);
    expect(claveDeIdempotenciaValida("Aa09_-Aa09_-Aa09_-")).toBe(true);
    expect(claveDeIdempotenciaValida("a".repeat(15))).toBe(false);
    expect(claveDeIdempotenciaValida("a".repeat(129))).toBe(false);
    expect(claveDeIdempotenciaValida("")).toBe(false);
  });

  it("rechaza cualquier otro carácter, también al principio, al medio y al final", () => {
    const base = "a".repeat(20);
    for (const malo of [" ", ".", "/", "ñ", "\n", "+", "="]) {
      expect(claveDeIdempotenciaValida(`${malo}${base}`), `inicio ${malo}`).toBe(false);
      expect(claveDeIdempotenciaValida(`${base}${malo}`), `fin ${JSON.stringify(malo)}`).toBe(
        false,
      );
      expect(claveDeIdempotenciaValida(`${base}${malo}${base}`), `medio ${malo}`).toBe(false);
    }
  });
});

describe("resultadoDePagina", () => {
  const pagina = { limite: 3, despuesDeId: null };
  const idDe = (fila: { id: string }) => fila.id;

  it("una lista vacía no tiene siguiente", () => {
    expect(resultadoDePagina([], pagina, idDe)).toEqual({ filas: [], siguienteDespuesDeId: null });
  });

  it("una lista vacía nunca tiene siguiente, ni siquiera con un límite de cero", () => {
    expect(resultadoDePagina([], { limite: 0, despuesDeId: null }, idDe)).toEqual({
      filas: [],
      siguienteDespuesDeId: null,
    });
  });

  it("una lista más corta que el límite no tiene siguiente", () => {
    const filas = [{ id: "a" }, { id: "b" }];
    expect(resultadoDePagina(filas, pagina, idDe)).toEqual({ filas, siguienteDespuesDeId: null });
  });

  it("una lista llena sigue desde el id del último renglón", () => {
    const filas = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(resultadoDePagina(filas, pagina, idDe)).toEqual({ filas, siguienteDespuesDeId: "c" });
  });

  it("con límite 1 y un renglón, hay siguiente", () => {
    expect(resultadoDePagina([{ id: "z" }], { limite: 1, despuesDeId: null }, idDe)).toEqual({
      filas: [{ id: "z" }],
      siguienteDespuesDeId: "z",
    });
  });
});

describe("filtroDeTexto", () => {
  it("sin valor no filtra", () => {
    expect(filtroDeTexto(undefined)).toEqual({ ok: true, valor: null });
  });

  it("recorta los espacios", () => {
    expect(filtroDeTexto("  tenant ")).toEqual({ ok: true, valor: "tenant" });
    expect(filtroDeTexto("x")).toEqual({ ok: true, valor: "x" });
  });

  it("no acepta vacío ni solo espacios", () => {
    for (const texto of ["", " ", "   ", "\t\n"]) {
      expect(filtroDeTexto(texto), JSON.stringify(texto)).toEqual({
        ok: false,
        error: "FILTRO_INVALIDO",
      });
    }
  });

  it("el largo máximo se mide después de recortar", () => {
    expect(LARGO_MAXIMO_DE_FILTRO).toBe(200);
    expect(filtroDeTexto("a".repeat(200))).toEqual({ ok: true, valor: "a".repeat(200) });
    expect(filtroDeTexto(`  ${"a".repeat(200)}  `)).toEqual({ ok: true, valor: "a".repeat(200) });
    expect(filtroDeTexto("a".repeat(201))).toEqual({ ok: false, error: "FILTRO_INVALIDO" });
  });
});

describe("rangoDeFechas", () => {
  const a = new Date("2026-10-01T00:00:00Z");
  const b = new Date("2026-10-02T00:00:00Z");
  const invalida = new Date("no es una fecha");

  it("sin extremos no filtra", () => {
    expect(rangoDeFechas(undefined, undefined)).toEqual({
      ok: true,
      valor: { desde: null, hasta: null },
    });
  });

  it("acepta un solo extremo o los dos, y los devuelve tal cual", () => {
    expect(rangoDeFechas(a, undefined)).toEqual({ ok: true, valor: { desde: a, hasta: null } });
    expect(rangoDeFechas(undefined, b)).toEqual({ ok: true, valor: { desde: null, hasta: b } });
    expect(rangoDeFechas(a, b)).toEqual({ ok: true, valor: { desde: a, hasta: b } });
  });

  it("desde igual a hasta es un rango válido (ambos extremos inclusivos)", () => {
    expect(rangoDeFechas(a, new Date(a.getTime()))).toEqual({
      ok: true,
      valor: { desde: a, hasta: a },
    });
  });

  it("un desde posterior al hasta es inválido", () => {
    expect(rangoDeFechas(b, a)).toEqual({ ok: false, error: "RANGO_INVALIDO" });
    expect(rangoDeFechas(new Date(a.getTime() + 1), a)).toEqual({
      ok: false,
      error: "RANGO_INVALIDO",
    });
  });

  it("una fecha inválida es RANGO_INVALIDO, en cualquiera de los dos extremos y sola", () => {
    expect(rangoDeFechas(invalida, undefined)).toEqual({ ok: false, error: "RANGO_INVALIDO" });
    expect(rangoDeFechas(undefined, invalida)).toEqual({ ok: false, error: "RANGO_INVALIDO" });
    expect(rangoDeFechas(invalida, b)).toEqual({ ok: false, error: "RANGO_INVALIDO" });
    expect(rangoDeFechas(a, invalida)).toEqual({ ok: false, error: "RANGO_INVALIDO" });
    expect(rangoDeFechas(invalida, invalida)).toEqual({ ok: false, error: "RANGO_INVALIDO" });
  });
});
