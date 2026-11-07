import { describe, expect, it } from "vitest";
import {
  CARACTERES_PERMITIDOS_DE_PASAPORTE,
  FORMATO_DE_PASAPORTE,
  LARGO_MAXIMO_DE_PASAPORTE,
  LARGO_MINIMO_DE_PASAPORTE,
  pasaporteDesdeTexto,
} from "./pasaporte";

const valido = (texto: string, esperado = texto) =>
  expect(pasaporteDesdeTexto(texto), JSON.stringify(texto)).toEqual({ ok: true, valor: esperado });
const invalido = (texto: string) =>
  expect(pasaporteDesdeTexto(texto), JSON.stringify(texto)).toEqual({
    ok: false,
    error: "PASAPORTE_INVALIDO",
  });

describe("pasaporteDesdeTexto (el pasaporte como figura)", () => {
  it("el largo es de 6 a 9 y está en una sola constante", () => {
    expect([LARGO_MINIMO_DE_PASAPORTE, LARGO_MAXIMO_DE_PASAPORTE]).toEqual([6, 9]);
    expect(CARACTERES_PERMITIDOS_DE_PASAPORTE).toBe("A-Z0-9");
    expect(FORMATO_DE_PASAPORTE.source).toBe("^[A-Z0-9]{6,9}$");
  });

  it("acepta 3 letras y 6 números, cualquier mezcla y solo números, en los bordes del largo", () => {
    for (const texto of ["ABC123456", "A1B2C3D4", "123456", "ABCDEF", "A".repeat(9), "1".repeat(9)])
      valido(texto);
  });

  it("minúsculas: se guardan en mayúsculas", () => {
    valido("abc123456", "ABC123456");
    valido("aBc123456", "ABC123456");
  });

  it("rechaza 5 y 10 caracteres, y todo lo que no es letra A-Z ni dígito (lista de permitidos)", () => {
    for (const texto of [
      "",
      "ABC12",
      "ABC1234567",
      "ABC-123456",
      "ABC 12345",
      " ABC12345",
      "ABC12345 ",
      "ABC12345\n",
      "ÑBC123456",
      "ÁBC123456",
      "ABC.12345",
      "ＡＢＣ123456", // letras de ancho completo
      "ABC１２３４５６", // dígitos de ancho completo
      "ßßß123456", // ß en mayúscula daría SS
      "ABC12345<",
      "ABC12345​", // invisible
    ])
      invalido(texto);
  });
});
