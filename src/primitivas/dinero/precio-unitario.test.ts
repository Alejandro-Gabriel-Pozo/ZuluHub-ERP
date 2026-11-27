import { describe, expect, it } from "vitest";
import {
  DECIMALES_DE_PRECIO_UNITARIO,
  ENTEROS_DE_PRECIO_UNITARIO,
  precioUnitarioATexto,
  precioUnitarioDesdeTexto,
} from "./precio-unitario";

/**
 * El precio unitario es `numeric(18,6)`: 6 decimales y 12 enteros. Los dos números que la web deriva (`DECIMALES_DE_PRECIO_UNITARIO`, `ENTEROS_DE_PRECIO_UNITARIO`) tienen que ser
 * exactamente lo que acepta el parser: un precio con 12 enteros entra y uno con 13 no. Previene: el campo de la web que deja escribir un precio que el servidor rechaza (o al revés).
 */
describe("límites del precio unitario (numeric(18,6))", () => {
  it("12 dígitos enteros y 6 decimales", () => {
    expect(ENTEROS_DE_PRECIO_UNITARIO).toBe(12);
    expect(DECIMALES_DE_PRECIO_UNITARIO).toBe(6);
    expect(ENTEROS_DE_PRECIO_UNITARIO + DECIMALES_DE_PRECIO_UNITARIO).toBe(18);
  });

  it("el máximo que cabe se acepta tal cual: 12 enteros con 6 decimales", () => {
    const maximo = `${"9".repeat(ENTEROS_DE_PRECIO_UNITARIO)}.${"9".repeat(DECIMALES_DE_PRECIO_UNITARIO)}`;
    expect(precioUnitarioATexto(precioUnitarioDesdeTexto(maximo))).toBe(maximo);
  });

  it("un dígito entero más (13) o un decimal más (7) se rechaza", () => {
    expect(() => precioUnitarioDesdeTexto(`1${"0".repeat(ENTEROS_DE_PRECIO_UNITARIO)}`)).toThrow();
    expect(() =>
      precioUnitarioDesdeTexto(`1.${"0".repeat(DECIMALES_DE_PRECIO_UNITARIO)}1`),
    ).toThrow();
  });

  it("ida y vuelta con los 6 decimales completos", () => {
    expect(precioUnitarioATexto(precioUnitarioDesdeTexto("9.95"))).toBe("9.950000");
    expect(precioUnitarioATexto(precioUnitarioDesdeTexto("0.000001"))).toBe("0.000001");
  });
});
