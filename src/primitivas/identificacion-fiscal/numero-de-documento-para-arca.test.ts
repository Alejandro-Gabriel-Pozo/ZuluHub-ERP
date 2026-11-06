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

  it("para todo documento de solo dígitos da exactamente el mismo número que BigInt (nada cambia para lo ya guardado)", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[0-9]{1,11}$/), (digitos) => {
        expect(numeroDeDocumentoInformadoAArca(digitos)).toBe(BigInt(digitos));
      }),
      { numRuns: 2000 },
    );
    for (const digitos of ["0", "00", "007", "30712345671", "12345678", "99999999999"])
      expect(numeroDeDocumentoInformadoAArca(digitos)).toBe(BigInt(digitos));
  });

  it("un documento sin ninguna cifra no se informa: lanza en lugar de mandar 0", () => {
    expect(() => numeroDeDocumentoInformadoAArca("ABCDEF")).toThrow(RangeError);
    expect(() => numeroDeDocumentoInformadoAArca("")).toThrow(RangeError);
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
