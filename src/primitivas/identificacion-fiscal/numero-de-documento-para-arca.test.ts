import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  numeroDeDocumentoInformadoAArca,
  tieneNumeroInformableAArca,
} from "./numero-de-documento-para-arca";

describe("numeroDeDocumentoInformadoAArca", () => {
  it("toma la parte numérica, en orden y sin los ceros de la izquierda", () => {
    expect(numeroDeDocumentoInformadoAArca("ABC123456")).toBe(123456n);
    expect(numeroDeDocumentoInformadoAArca("AAB000123")).toBe(123n);
    expect(numeroDeDocumentoInformadoAArca("A1B2C3D4")).toBe(1234n);
    expect(numeroDeDocumentoInformadoAArca("1234ABC56")).toBe(123456n);
  });

  it("un pasaporte de solo dígitos con alguna cifra distinta de cero da el mismo número que BigInt", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[0-9]{0,10}[1-9][0-9]{0,10}$/), (digitos) => {
        expect(numeroDeDocumentoInformadoAArca(digitos)).toBe(BigInt(digitos));
      }),
      { numRuns: 2000 },
    );
    for (const digitos of ["007", "30712345671", "12345678", "99999999999"])
      expect(numeroDeDocumentoInformadoAArca(digitos)).toBe(BigInt(digitos));
  });

  it("un documento sin ninguna cifra no se informa: lanza en lugar de mandar 0", () => {
    const mensaje = "el documento no tiene ninguna cifra que informar a ARCA";
    expect(() => numeroDeDocumentoInformadoAArca("ABCDEF")).toThrow(new RangeError(mensaje));
    expect(() => numeroDeDocumentoInformadoAArca("")).toThrow(new RangeError(mensaje));
    // Todo en cero daría DocNro 0 («sin identificar» para ARCA): también lanza.
    for (const n of ["ABC000000", "000000", "0", "00"])
      expect(() => numeroDeDocumentoInformadoAArca(n), n).toThrow(new RangeError(mensaje));
  });
});

describe("tieneNumeroInformableAArca", () => {
  it("exige una cifra del 1 al 9", () => {
    for (const n of ["ABC123456", "AAB000123", "1", "A0B0C1"])
      expect(tieneNumeroInformableAArca(n)).toBe(true);
    for (const n of ["ABCDEF", "ABC000000", "000000", ""])
      expect(tieneNumeroInformableAArca(n)).toBe(false);
  });
});
