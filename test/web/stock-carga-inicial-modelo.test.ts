import { describe, expect, it } from "vitest";
import {
  errorDeLaFila,
  FILA_VACIA,
  filaCompleta,
  opcionesParaLaFila,
  puedeRegistrar,
  resumenDeLaCarga,
  valorDeLaFila,
  type FilaDeCarga,
} from "../../apps/web/ui/plantillas/stock/carga-inicial/modelo-de-carga-inicial";

/** El modelo de la grilla de «Carga inicial» (FP-STK-08): el valor de cada fila con las primitivas del dinero (sin `number`), el total, el resumen y qué fila está lista o mal. Puro. */
const fila = (clave: number, cambios: Partial<FilaDeCarga> = {}): FilaDeCarga => ({
  ...FILA_VACIA(clave),
  articuloId: `a${clave}`,
  cantidad: "1",
  ...cambios,
});

describe("valorDeLaFila (cantidad × costo, a centavos, con formato de pesos)", () => {
  it("multiplica exacto y redondea a centavos con la política del sistema (la mitad se aleja del cero)", () => {
    expect(valorDeLaFila(fila(1, { cantidad: "10", costo: "12.5" }))).toBe("$ 125,00");
    expect(valorDeLaFila(fila(1, { cantidad: "3", costo: "12000.5" }))).toBe("$ 36.001,50");
    expect(valorDeLaFila(fila(1, { cantidad: "1", costo: "0.005" }))).toBe("$ 0,01");
    expect(valorDeLaFila(fila(1, { cantidad: "1", costo: "0.004999" }))).toBe("$ 0,00");
    expect(valorDeLaFila(fila(1, { cantidad: "0.0001", costo: "0.000001" }))).toBe("$ 0,00");
    expect(valorDeLaFila(fila(1, { cantidad: "2.5", costo: "1234567.891234" }))).toBe(
      "$ 3.086.419,73",
    );
  });

  it("sin costo, sin cantidad, con cantidad cero o con texto roto no hay valor (nada se inventa)", () => {
    for (const cambios of [
      { costo: "" },
      { cantidad: "", costo: "5" },
      { cantidad: "0", costo: "5" },
      { cantidad: "x", costo: "5" },
      { costo: "no es un costo" },
      { costo: "1.1234567" },
    ]) {
      expect(valorDeLaFila(fila(1, cambios)), JSON.stringify(cambios)).toBeNull();
    }
  });
});

describe("errorDeLaFila y filaCompleta", () => {
  it("lo que todavía no se escribió no es un error; una cantidad cero o un costo roto, sí", () => {
    expect(errorDeLaFila(fila(1, { cantidad: "" }))).toBeNull();
    expect(errorDeLaFila(fila(1, { cantidad: "5", costo: "" }))).toBeNull();
    expect(errorDeLaFila(fila(1, { cantidad: "0" }))).toBe("CANTIDAD");
    expect(errorDeLaFila(fila(1, { cantidad: "1.12345" }))).toBe("CANTIDAD");
    expect(errorDeLaFila(fila(1, { costo: "abc" }))).toBe("COSTO");
    expect(errorDeLaFila(fila(1, { costo: "1.1234567" }))).toBe("COSTO");
  });

  it("un costo y una cantidad válidos cuyo valor no entra en el importe máximo se marcan como costo", () => {
    expect(
      errorDeLaFila(fila(1, { cantidad: "99999999999999", costo: "999999999999.999999" })),
    ).toBe("COSTO");
  });

  it("una fila completa tiene artículo, cantidad mayor que cero y, si hay costo, uno que sirve", () => {
    expect(filaCompleta(fila(1))).toBe(true);
    expect(filaCompleta(fila(1, { costo: "2" }))).toBe(true);
    expect(filaCompleta(fila(1, { articuloId: "" }))).toBe(false);
    expect(filaCompleta(fila(1, { cantidad: "" }))).toBe(false);
    expect(filaCompleta(fila(1, { cantidad: "0" }))).toBe(false);
    expect(filaCompleta(fila(1, { costo: "x" }))).toBe(false);
  });
});

describe("puedeRegistrar", () => {
  it("pide depósito, al menos una fila y TODAS completas: una fila a medias frena la tanda", () => {
    expect(puedeRegistrar("d1", [fila(1)])).toBe(true);
    expect(puedeRegistrar("", [fila(1)])).toBe(false);
    expect(puedeRegistrar("d1", [])).toBe(false);
    expect(puedeRegistrar("d1", [fila(1), fila(2, { cantidad: "" })])).toBe(false);
    expect(puedeRegistrar("d1", [fila(1), fila(2, { costo: "x" })])).toBe(false);
  });
});

describe("resumenDeLaCarga", () => {
  it("cuenta las filas completas, suma los valores YA redondeados de las filas con costo y cuenta las que van sin costo", () => {
    const r = resumenDeLaCarga([
      fila(1, { cantidad: "10", costo: "12.5" }),
      fila(2, { cantidad: "2", costo: "0.50" }),
      fila(3, { cantidad: "4" }),
      fila(4, { cantidad: "" }),
    ]);
    expect(r).toEqual({ articulos: 3, total: "$ 126,00", sinCosto: 1 });
  });

  it("el total es la suma de filas redondeadas (lo que se verifica a mano), no la suma exacta redondeada una vez", () => {
    const tres = [1, 2, 3].map((n) => fila(n, { cantidad: "1", costo: "0.005" }));
    expect(resumenDeLaCarga(tres).total).toBe("$ 0,03");
  });

  it("sin ninguna fila con costo no hay total; 500 filas suman exacto hasta el último centavo", () => {
    expect(resumenDeLaCarga([fila(1)])).toEqual({ articulos: 1, total: null, sinCosto: 1 });
    expect(resumenDeLaCarga([])).toEqual({ articulos: 0, total: null, sinCosto: 0 });
    const muchas = Array.from({ length: 500 }, (_, i) =>
      fila(i + 1, { cantidad: "3", costo: "1234.57" }),
    );
    // 500 × (3 × 1234.57 = 3703.71) = 1.851.855,00
    expect(resumenDeLaCarga(muchas)).toEqual({
      articulos: 500,
      total: "$ 1.851.855,00",
      sinCosto: 0,
    });
  });

  it("un total que no entra en el importe máximo no se inventa", () => {
    const enormes = [1, 2].map((n) =>
      fila(n, { cantidad: "99999999999999", costo: "9999.999999" }),
    );
    expect(resumenDeLaCarga(enormes).total).toBeNull();
  });
});

describe("opcionesParaLaFila", () => {
  it("ofrece todos los artículos menos los ya elegidos en las OTRAS filas (el de la propia fila queda)", () => {
    const opciones = [{ valor: "a1" }, { valor: "a2" }, { valor: "a3" }];
    const filas = [fila(1), fila(2)];
    expect(opcionesParaLaFila(opciones, filas, 1).map((o) => o.valor)).toEqual(["a1", "a3"]);
    expect(opcionesParaLaFila(opciones, filas, 2).map((o) => o.valor)).toEqual(["a2", "a3"]);
    expect(opcionesParaLaFila(opciones, filas, -1).map((o) => o.valor)).toEqual(["a3"]);
  });
});
