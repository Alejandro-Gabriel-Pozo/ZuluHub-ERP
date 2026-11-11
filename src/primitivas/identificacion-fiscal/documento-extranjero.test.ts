import { describe, expect, it } from "vitest";
import {
  FORMATO_DE_DOCUMENTO_EXTRANJERO,
  LARGO_MAXIMO_DE_DOCUMENTO_EXTRANJERO,
  LARGO_MINIMO_DE_DOCUMENTO_EXTRANJERO,
  documentoExtranjeroDesdeTexto,
} from "./documento-extranjero";

const valido = (texto: string, esperado = texto) =>
  expect(documentoExtranjeroDesdeTexto(texto), JSON.stringify(texto)).toEqual({
    ok: true,
    valor: esperado,
  });
const invalido = (texto: string) =>
  expect(documentoExtranjeroDesdeTexto(texto), JSON.stringify(texto)).toEqual({
    ok: false,
    error: "DOCUMENTO_EXTRANJERO_INVALIDO",
  });

describe("documentoExtranjeroDesdeTexto", () => {
  it("el largo es de 3 a 20 y está en constantes", () => {
    expect([LARGO_MINIMO_DE_DOCUMENTO_EXTRANJERO, LARGO_MAXIMO_DE_DOCUMENTO_EXTRANJERO]).toEqual([
      3, 20,
    ]);
    expect(FORMATO_DE_DOCUMENTO_EXTRANJERO.source).toBe("^[A-Z0-9]{3,20}$");
  });

  it("acepta letras y números en los bordes del largo", () => {
    for (const texto of ["RUT12345678", "ABC", "123", "A".repeat(20), "9".repeat(20)])
      valido(texto);
  });

  it("las minúsculas ASCII se guardan en mayúsculas", () => {
    valido("abc123", "ABC123");
    valido("aZ9", "AZ9");
  });

  it("rechaza menos de 3, más de 20, separadores, tildes, blancos, vacío y la ß", () => {
    for (const texto of [
      "AB",
      "",
      "A".repeat(21),
      "12-345",
      "RUT 123",
      "ÑAB123",
      " ABC",
      "ABC ",
      "ABC.123",
      "ß12",
      "ABC\n",
    ]) {
      invalido(texto);
    }
  });
});
