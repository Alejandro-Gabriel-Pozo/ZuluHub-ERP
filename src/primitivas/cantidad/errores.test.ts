import { describe, expect, it } from "vitest";
import { cantidadDesdeTexto } from "./cantidad";
import { parsearDecimalFijo, validarRango } from "./decimal-fijo";
import { ErrorDeValor } from "./errores";
import { porcentajeDesdeTexto } from "./porcentaje";

function errorDe(accion: () => unknown): ErrorDeValor {
  try {
    accion();
  } catch (e) {
    if (e instanceof ErrorDeValor) return e;
    throw e;
  }
  throw new Error("se esperaba un ErrorDeValor");
}

describe("ErrorDeValor", () => {
  it("lleva el código, un nombre propio y un mensaje que empieza con el código", () => {
    const e = new ErrorDeValor("FORMATO_INVALIDO", "detalle de prueba");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("ErrorDeValor");
    expect(e.codigo).toBe("FORMATO_INVALIDO");
    expect(e.message).toBe("FORMATO_INVALIDO: detalle de prueba");
  });
});

describe("los mensajes dicen qué campo falló (para quien lee el error en la frontera)", () => {
  it("parsearDecimalFijo", () => {
    expect(errorDe(() => parsearDecimalFijo("1".repeat(41), 2, "campo-x")).message).toBe(
      "FORMATO_INVALIDO: campo-x: texto demasiado largo",
    );
    expect(errorDe(() => parsearDecimalFijo("1,5", 2, "campo-x")).message).toBe(
      "FORMATO_INVALIDO: campo-x: no es un decimal en forma canónica",
    );
    expect(errorDe(() => parsearDecimalFijo("1.555", 2, "campo-x")).message).toBe(
      "DECIMALES_DE_MAS: campo-x: admite hasta 2 decimales",
    );
    expect(errorDe(() => parsearDecimalFijo("-0.00", 2, "campo-x")).message).toBe(
      "FORMATO_INVALIDO: campo-x: el cero no lleva signo",
    );
    expect(errorDe(() => validarRango(5n, 0n, 4n, "campo-x")).message).toBe(
      "FUERA_DE_RANGO: campo-x: fuera del rango admitido",
    );
  });

  it("cada tipo nombra su campo", () => {
    expect(errorDe(() => cantidadDesdeTexto("x")).message).toContain("cantidad:");
    expect(errorDe(() => cantidadDesdeTexto("-1")).message).toContain("cantidad:");
    expect(errorDe(() => porcentajeDesdeTexto("x")).message).toContain("porcentaje:");
    expect(errorDe(() => porcentajeDesdeTexto("101")).message).toContain("porcentaje:");
  });
});
