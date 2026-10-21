import { describe, expect, it } from "vitest";
import {
  evaluarContraste,
  razonDeContraste,
  type CatalogoDeContraste,
} from "../../apps/plataforma/logica/contraste-de-submarca";
import type { ColoresDeSubmarca } from "../../apps/plataforma/logica/submarca";
import {
  COLORES_DE_SUPERFICIE,
  razonDeContraste as razonDelBackend,
} from "../../src/modulos/marcas/dominio/tema";

const CATALOGO: CatalogoDeContraste = {
  superficies: [
    { valor: "NEUTRA", fondo: "#ffffff", superficie: "#f3f5f7" },
    { valor: "CALIDA", fondo: "#fbf7f1", superficie: "#f3eadc" },
    { valor: "FRIA", fondo: "#f5f8fc", superficie: "#e6edf6" },
  ],
  pares: [
    { par: "on-primary/primary", minimo: 4.5 },
    { par: "accent/fondo", minimo: 3 },
    { par: "accent/superficie", minimo: 3 },
  ],
};

const COLORES: ColoresDeSubmarca = {
  primary: "#9a3412",
  onPrimary: "#ffffff",
  secondary: "#334155",
  accent: "#0f766e",
};

describe("razonDeContraste", () => {
  it("blanco sobre negro es 21", () => {
    expect(razonDeContraste("#ffffff", "#000000")).toBe(21);
  });
  it("coincide con la del backend", () => {
    const pares: [string, string][] = [
      ["#9a3412", "#ffffff"],
      ["#0f766e", "#fbf7f1"],
      ["#0f766e", "#e6edf6"],
      ["#777777", "#ffffff"],
      ["#767676", "#ffffff"],
      ["#ff0000", "#00ff00"],
      ["#123456", "#abcdef"],
      ["#0a0a0a", "#0b0b0b"],
      ["#ffffff", "#ffffff"],
      ["#f3eadc", "#334155"],
    ];
    for (const [a, b] of pares) {
      expect(razonDeContraste(a, b)).toBeCloseTo(razonDelBackend(a, b), 12);
    }
  });
});

describe("catálogo de la prueba", () => {
  it("los hex de superficie son los del backend", () => {
    for (const s of CATALOGO.superficies) {
      expect(COLORES_DE_SUPERFICIE[s.valor as keyof typeof COLORES_DE_SUPERFICIE]).toEqual({
        fondo: s.fondo,
        superficie: s.superficie,
      });
    }
  });
});

describe("evaluarContraste", () => {
  it("devuelve los tres pares en orden", () => {
    const r = evaluarContraste(COLORES, "NEUTRA", CATALOGO);
    expect(r.map((x) => x.par)).toEqual([
      "on-primary/primary",
      "accent/fondo",
      "accent/superficie",
    ]);
    expect(r.map((x) => x.minimo)).toEqual([4.5, 3, 3]);
    expect(r.every((x) => x.cumple === true && x.texto === null)).toBe(true);
  });

  it("un valor justo por debajo del mínimo no cumple (sin redondear)", () => {
    // Busca un gris cuyo contraste sobre blanco quede en [4,49 ; 4,5).
    let gris = "";
    for (let v = 0; v < 256; v++) {
      const h = v.toString(16).padStart(2, "0");
      const r = razonDeContraste(`#${h}${h}${h}`, "#ffffff");
      if (r < 4.5 && r >= 4.4) gris = `#${h}${h}${h}`;
    }
    expect(gris).not.toBe("");
    const razon = razonDeContraste(gris, "#ffffff");
    const [texto] = evaluarContraste({ ...COLORES, primary: gris }, "NEUTRA", CATALOGO);
    expect(texto?.cumple).toBe(false);
    expect(texto?.razon).toBe(razon);
    expect(texto?.texto).toMatch(/de 4,5 que se necesita\.$/);
    expect(texto?.texto).toContain("llega a 4,4 de");
  });

  it("el mensaje trunca, usa coma y nombra la superficie", () => {
    // Amarillo claro de acento sobre la superficie cálida.
    const r = evaluarContraste({ ...COLORES, accent: "#d4a017" }, "CALIDA", CATALOGO);
    const fondo = r[1];
    const razon = razonDeContraste("#d4a017", "#fbf7f1");
    expect(fondo?.cumple).toBe(false);
    const esperado = (Math.floor(razon * 10) / 10).toFixed(1).replace(".", ",");
    expect(fondo?.texto).toBe(
      `El acento no se lee sobre el fondo de la superficie cálida: llega a ${esperado} de 3,0 que se necesita.`,
    );
    expect(r[2]?.texto).toContain("sobre las tarjetas de la superficie cálida");
  });

  it("el texto sobre el principal tiene su mensaje", () => {
    const [t] = evaluarContraste({ ...COLORES, primary: "#ffff00" }, "FRIA", CATALOGO);
    expect(t?.texto).toMatch(
      /^El texto no se lee sobre el color principal: llega a \d,\d de 4,5 que se necesita\.$/,
    );
  });

  it("falta un color: razón y cumple nulos", () => {
    const r = evaluarContraste({ ...COLORES, accent: "", onPrimary: "xyz" }, "NEUTRA", CATALOGO);
    for (const x of r) {
      expect(x.razon).toBeNull();
      expect(x.cumple).toBeNull();
      expect(x.texto).toMatch(/^Falta definir el color /);
    }
  });

  it("superficie desconocida deja sin medir los pares del acento", () => {
    const r = evaluarContraste(COLORES, "OTRA", CATALOGO);
    expect(r[0]?.cumple).toBe(true);
    expect(r[1]?.cumple).toBeNull();
    expect(r[2]?.cumple).toBeNull();
  });
});
