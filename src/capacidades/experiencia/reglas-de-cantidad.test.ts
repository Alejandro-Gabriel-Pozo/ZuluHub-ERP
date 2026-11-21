import { describe, expect, it } from "vitest";
import { cantidadDesdeTexto } from "../../primitivas/cantidad/cantidad";
import { mermaDesdeTexto } from "../../primitivas/cantidad/merma";
import { escribirNumero, interpretarNumeroPegado } from "./numero-argentino";
import { REGLA_DE_CANTIDAD, REGLA_DE_MERMA } from "./reglas-de-cantidad";

describe("REGLA_DE_CANTIDAD", () => {
  it("son las medidas de la primitiva: 14 enteros, 4 decimales, sin ceros de relleno", () => {
    expect(REGLA_DE_CANTIDAD).toEqual({ decimales: 4, enterosMaximos: 14 });
  });

  it("lo que el campo entrega la primitiva lo acepta", () => {
    const pegado = interpretarNumeroPegado("12.345,6789", REGLA_DE_CANTIDAD);
    expect(pegado.ok && pegado.canonico).toBe("12345.6789");
    expect(() => cantidadDesdeTexto("12345.6789")).not.toThrow();
  });

  it("un quinto decimal o un entero de más se rechaza al pegar y no se escribe", () => {
    expect(interpretarNumeroPegado("1,12345", REGLA_DE_CANTIDAD)).toEqual({
      ok: false,
      motivo: "DECIMALES_DE_MAS",
    });
    expect(interpretarNumeroPegado("123456789012345", REGLA_DE_CANTIDAD).ok).toBe(false);
    expect(escribirNumero("1,12345", 7, REGLA_DE_CANTIDAD).canonico).toBe("1.1234");
  });

  it("el cero a secas no se completa: `5` queda `5`", () => {
    expect(escribirNumero("5", 1, REGLA_DE_CANTIDAD).canonico).toBe("5");
  });
});

describe("REGLA_DE_MERMA", () => {
  it("son las medidas de la primitiva: 2 enteros, 4 decimales", () => {
    expect(REGLA_DE_MERMA).toEqual({ decimales: 4, enterosMaximos: 2 });
  });

  it("el campo no deja pegar 100 ni más: la primitiva tampoco lo acepta", () => {
    for (const texto of ["100", "100,5", "250"]) {
      expect(interpretarNumeroPegado(texto, REGLA_DE_MERMA).ok).toBe(false);
    }
    expect(mermaDesdeTexto("100").ok).toBe(false);
  });

  it("lo que el campo deja pegar la primitiva lo acepta", () => {
    for (const texto of ["0", "10", "10,5", "99,9999"]) {
      const pegado = interpretarNumeroPegado(texto, REGLA_DE_MERMA);
      expect(pegado.ok).toBe(true);
      expect(pegado.ok && mermaDesdeTexto(pegado.canonico).ok).toBe(true);
    }
  });
});
