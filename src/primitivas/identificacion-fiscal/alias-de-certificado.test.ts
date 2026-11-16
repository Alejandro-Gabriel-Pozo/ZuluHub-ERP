import { describe, expect, it } from "vitest";
import {
  LARGO_MAXIMO_DEL_ALIAS_DE_CERTIFICADO,
  esAliasDeCertificado,
} from "./alias-de-certificado";

describe("alias de certificado", () => {
  it("admite hasta 30 caracteres", () => {
    expect(LARGO_MAXIMO_DEL_ALIAS_DE_CERTIFICADO).toBe(30);
    expect(esAliasDeCertificado("a".repeat(30))).toBe(true);
    expect(esAliasDeCertificado("a".repeat(31))).toBe(false);
  });

  it.each(["a", "A", "0", "Caja1", "ABCdef123"])("acepta «%s»", (texto) => {
    expect(esAliasDeCertificado(texto)).toBe(true);
  });

  it.each(["", " ", "a b", "ñ", "a-b", "a_b", "a\n", "\na", "a.b"])("rechaza «%s»", (texto) => {
    expect(esAliasDeCertificado(texto)).toBe(false);
  });
});
