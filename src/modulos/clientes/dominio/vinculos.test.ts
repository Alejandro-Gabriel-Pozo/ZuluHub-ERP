import { describe, expect, it } from "vitest";
import { REGLAS_DE_VINCULO, TIPOS_DE_VINCULO, esTipoDeVinculo, validarVinculo } from "./vinculos";

const persona = { id: "a", naturaleza: "HUMANA" } as const;
const empresa = { id: "b", naturaleza: "JURIDICA" } as const;
const otraPersona = { id: "c", naturaleza: "HUMANA" } as const;

describe("vínculos entre partes", () => {
  it("los tipos y sus banderas son los de la tabla sembrada", () => {
    expect([...TIPOS_DE_VINCULO]).toEqual(["CONTACTO", "AGENTE_DE"]);
    expect(REGLAS_DE_VINCULO).toEqual({
      CONTACTO: { contactoHumana: true, deParteJuridica: false },
      AGENTE_DE: { contactoHumana: true, deParteJuridica: true },
    });
    expect(esTipoDeVinculo("CONTACTO")).toBe(true);
    expect(esTipoDeVinculo("AGENTE_DE")).toBe(true);
    for (const t of ["contacto", "", "JEFE_DE"]) expect(esTipoDeVinculo(t)).toBe(false);
  });

  it("una persona es contacto de una empresa o de otra persona", () => {
    expect(validarVinculo("CONTACTO", persona, empresa)).toEqual({ ok: true, valor: null });
    expect(validarVinculo("CONTACTO", persona, otraPersona)).toEqual({ ok: true, valor: null });
  });

  it("una persona es agente de una empresa, no de otra persona", () => {
    expect(validarVinculo("AGENTE_DE", persona, empresa)).toEqual({ ok: true, valor: null });
    expect(validarVinculo("AGENTE_DE", persona, otraPersona)).toEqual({
      ok: false,
      error: "VINCULO_DEBE_SER_CON_EMPRESA",
    });
  });

  it("una empresa no es contacto ni agente", () => {
    for (const tipo of TIPOS_DE_VINCULO) {
      expect(validarVinculo(tipo, empresa, persona)).toEqual({
        ok: false,
        error: "CONTACTO_DEBE_SER_HUMANA",
      });
    }
  });

  it("nadie es contacto de sí mismo, y eso se informa antes que lo demás", () => {
    expect(validarVinculo("CONTACTO", persona, persona)).toEqual({
      ok: false,
      error: "VINCULO_CONSIGO_MISMA",
    });
    expect(validarVinculo("AGENTE_DE", empresa, empresa)).toEqual({
      ok: false,
      error: "VINCULO_CONSIGO_MISMA",
    });
  });
});
