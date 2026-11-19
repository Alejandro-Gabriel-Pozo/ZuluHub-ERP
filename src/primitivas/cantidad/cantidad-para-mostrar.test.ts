import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../test/propiedades/configuracion";
import { cantidadParaMostrar } from "./cantidad-para-mostrar";

const unidad = (c: string, o?: { fraccionEnAscii?: boolean }) =>
  cantidadParaMostrar(c, { unidadDeVenta: "UNIDAD" }, o);
const valor = (r: ReturnType<typeof cantidadParaMostrar>) => (r.ok ? r.valor : r.error);

describe("cantidadParaMostrar: por unidad", () => {
  it.each([
    ["1", "1"],
    ["2", "2"],
    ["12", "12"],
    ["0.5", "½"],
    ["0.25", "¼"],
    ["0.75", "¾"],
    ["0.125", "⅛"],
    ["0.375", "⅜"],
    ["0.625", "⅝"],
    ["0.875", "⅞"],
    ["1.5", "1 ½"],
    ["2.75", "2 ¾"],
    ["3.125", "3 ⅛"],
    ["10.5", "10 ½"],
  ])("%s se muestra %s", (cantidad, esperada) => {
    expect(valor(unidad(cantidad))).toBe(esperada);
  });

  it("la variante ASCII usa barra para el papel térmico que no dibuja «½»", () => {
    for (const [cantidad, esperada] of [
      ["1", "1"],
      ["0.5", "1/2"],
      ["0.75", "3/4"],
      ["0.125", "1/8"],
      ["1.5", "1 1/2"],
      ["2.875", "2 7/8"],
    ] as const) {
      expect(valor(unidad(cantidad, { fraccionEnAscii: true })), cantidad).toBe(esperada);
    }
    expect(valor(unidad("0.5", { fraccionEnAscii: false }))).toBe("½");
  });

  it("un tercio, un décimo o un dieciseisavo no existen: no se muestran como fracción", () => {
    for (const c of ["0.3333", "0.6667", "0.1", "0.0625", "0.0001", "1.3333", "0.9999"]) {
      expect(valor(unidad(c)), c).toBe("CANTIDAD_NO_MOSTRABLE");
    }
  });

  it("solo positivas y bien escritas: cero, negativas, coma, notación científica y basura se rechazan", () => {
    for (const c of ["0", "0.0000", "-1", "1,5", "1e3", "", "abc", " 1", "1.00001"]) {
      expect(valor(unidad(c)), JSON.stringify(c)).toBe("CANTIDAD_NO_MOSTRABLE");
    }
  });

  it("un defecto que no es un valor mal escrito (un tipo forzado) no se traga: se propaga", () => {
    expect(() => unidad(undefined as unknown as string)).toThrow();
  });

  it("con el paso congelado, la cantidad tiene que ser múltiplo exacto de él; sin paso no se mira", () => {
    const con = (c: string, paso: string) =>
      valor(cantidadParaMostrar(c, { unidadDeVenta: "UNIDAD", paso }));
    expect(con("1.5", "0.5")).toBe("1 ½");
    expect(con("0.75", "0.25")).toBe("¾");
    expect(con("0.75", "0.5")).toBe("CANTIDAD_NO_MOSTRABLE");
    expect(con("0.5", "0.5")).toBe("½");
    expect(con("1", "0")).toBe("CANTIDAD_NO_MOSTRABLE");
    expect(con("1", "x")).toBe("CANTIDAD_NO_MOSTRABLE");
    expect(con("1", "-1")).toBe("CANTIDAD_NO_MOSTRABLE");
    expect(valor(cantidadParaMostrar("0.75", { unidadDeVenta: "UNIDAD", paso: undefined }))).toBe(
      "¾",
    );
  });
});

describe("cantidadParaMostrar: peso, volumen y demás", () => {
  const con = (c: string, u: string) => valor(cantidadParaMostrar(c, { unidadDeVenta: u }));
  it.each([
    ["350", "GRAMO", "350 g"],
    ["1.5", "KILOGRAMO", "1,5 kg"],
    ["0.25", "KILOGRAMO", "0,25 kg"],
    ["2", "LITRO", "2 l"],
    ["0.0001", "TONELADA", "0,0001 t"],
    ["500", "MILILITRO", "500 ml"],
    ["1.2", "METRO_CUBICO", "1,2 m³"],
    ["3", "MINUTO", "3 min"],
    ["2.5", "HORA", "2,5 h"],
    ["0.3333", "GRAMO", "0,3333 g"],
  ])("%s %s → %s (sin fracciones)", (c, u, esperada) => {
    expect(con(c, u)).toBe(esperada);
  });
  it("una unidad que no existe se rechaza", () => {
    expect(con("1", "CAJON")).toBe("CANTIDAD_NO_MOSTRABLE");
    expect(con("1", "")).toBe("CANTIDAD_NO_MOSTRABLE");
    expect(con("1", "toString")).toBe("CANTIDAD_NO_MOSTRABLE");
  });
});

describe("cantidadParaMostrar: propiedades", () => {
  it("todo entero más un octavo (de 0 a 99) se muestra, y la variante ASCII dice lo mismo en barra", () => {
    const OCTAVOS = ["", ".125", ".25", ".375", ".5", ".625", ".75", ".875"] as const;
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 99 }), fc.integer({ min: 0, max: 7 }), (entero, i) => {
        const texto = `${entero}${OCTAVOS[i] ?? ""}`;
        fc.pre(texto !== "0");
        const normal = cantidadParaMostrar(texto, { unidadDeVenta: "UNIDAD" });
        const ascii = cantidadParaMostrar(
          texto,
          { unidadDeVenta: "UNIDAD" },
          { fraccionEnAscii: true },
        );
        expect(normal.ok && ascii.ok).toBe(true);
        if (!normal.ok || !ascii.ok) return;
        expect(normal.valor).not.toMatch(/[./,]/);
        expect(ascii.valor).not.toMatch(/[½¼¾⅛⅜⅝⅞]/);
        const aBarra = normal.valor
          .replace("½", "1/2")
          .replace("¼", "1/4")
          .replace("¾", "3/4")
          .replace("⅛", "1/8")
          .replace("⅜", "3/8")
          .replace("⅝", "5/8")
          .replace("⅞", "7/8");
        expect(aBarra).toBe(ascii.valor);
      }),
    );
  });
  it("nunca devuelve una fracción que no sea de 2, 4 u 8, ni un texto vacío", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 200_000 }), (diezmilesimos) => {
        const texto = `${(diezmilesimos - (diezmilesimos % 10_000)) / 10_000}.${String(diezmilesimos % 10_000).padStart(4, "0")}`;
        const r = cantidadParaMostrar(texto, { unidadDeVenta: "UNIDAD" });
        if (r.ok) {
          expect(r.valor.length).toBeGreaterThan(0);
          expect(r.valor).toMatch(/^(\d+)( ?[½¼¾⅛⅜⅝⅞])?$/);
        } else {
          expect(r.error).toBe("CANTIDAD_NO_MOSTRABLE");
        }
      }),
    );
  });
});
