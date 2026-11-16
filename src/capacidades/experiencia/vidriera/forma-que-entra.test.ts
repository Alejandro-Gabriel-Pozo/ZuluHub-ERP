import { describe, expect, it } from "vitest";
import { COLUMNAS_QUE_ENTRAN, formaQueEntra } from "./forma-que-entra";
import { PASOS_DE_LETRA } from "./letra";

describe("formaQueEntra", () => {
  it("una tabla de hasta 3 medidas entra con letra normal y grande; con letra muy grande solo 2", () => {
    expect(formaQueEntra("TABLA", 3, "NORMAL")).toBe("TABLA");
    expect(formaQueEntra("TABLA", 3, "GRANDE")).toBe("TABLA");
    expect(formaQueEntra("TABLA", 3, "MUY_GRANDE")).toBe("LISTA");
    expect(formaQueEntra("TABLA", 2, "MUY_GRANDE")).toBe("TABLA");
  });

  it("la LISTA y la LINEA ya son filas: no cambian nunca", () => {
    for (const paso of PASOS_DE_LETRA) {
      expect(formaQueEntra("LISTA", 5, paso)).toBe("LISTA");
      expect(formaQueEntra("LINEA", 0, paso)).toBe("LINEA");
    }
  });

  it("más columnas que las que entran baja a filas, en todos los pasos", () => {
    for (const paso of PASOS_DE_LETRA) {
      expect(formaQueEntra("TABLA", COLUMNAS_QUE_ENTRAN[paso] + 1, paso)).toBe("LISTA");
      expect(formaQueEntra("TABLA", COLUMNAS_QUE_ENTRAN[paso], paso)).toBe("TABLA");
    }
  });

  it("una cantidad de columnas rota no es una tabla (cierra hacia filas)", () => {
    for (const rota of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formaQueEntra("TABLA", rota, "NORMAL"), String(rota)).toBe("LISTA");
    }
  });

  it("agrandar la letra nunca convierte filas en tabla", () => {
    for (let columnas = 1; columnas <= 6; columnas++) {
      const orden = PASOS_DE_LETRA.map((p) => formaQueEntra("TABLA", columnas, p));
      const primeraLista = orden.indexOf("LISTA");
      if (primeraLista !== -1)
        expect(orden.slice(primeraLista).every((f) => f === "LISTA")).toBe(true);
    }
  });
});
