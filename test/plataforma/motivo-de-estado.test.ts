import { describe, expect, it } from "vitest";
import {
  TEXTO_DE_MOTIVO_GENERICO,
  textoDelMotivoDeEstado,
} from "../../apps/plataforma/logica/motivo-de-estado";

describe("textoDelMotivoDeEstado", () => {
  it.each(["ALTA_VENCIDA", "ALTA_CANCELADA", "REVOCADA_POR_PLATAFORMA"])(
    "traduce el código conocido %s sin mostrarlo crudo",
    (motivo) => {
      const texto = textoDelMotivoDeEstado(motivo);
      expect(texto).not.toBe(TEXTO_DE_MOTIVO_GENERICO);
      expect(texto).not.toContain(motivo);
    },
  );

  it("traduce «mora» a una frase", () => {
    expect(textoDelMotivoDeEstado("mora")).toBe("Suspendida por mora.");
  });

  it.each(["MOTIVO_NUEVO", "", "  ", "constructor", "__proto__", "toString"])(
    "un código desconocido o vacío (%j) sale genérico, nunca crudo",
    (motivo) => {
      expect(textoDelMotivoDeEstado(motivo)).toBe(TEXTO_DE_MOTIVO_GENERICO);
    },
  );

  it("el texto escrito por una persona se muestra tal cual", () => {
    expect(textoDelMotivoDeEstado("se arrepintió")).toBe("se arrepintió");
  });
});
