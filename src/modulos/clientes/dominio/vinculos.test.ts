import { describe, expect, it } from "vitest";
import {
  LARGO_MAXIMO_DEL_CARGO_DE_VINCULO,
  REGLAS_DE_VINCULO,
  TIPOS_DE_VINCULO,
  cargoDeVinculoDesdeTexto,
  esTipoDeVinculo,
  validarVinculo,
} from "./vinculos";

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

describe("cargoDeVinculoDesdeTexto", () => {
  it("es opcional: ausente, nulo o en blanco queda null", () => {
    for (const texto of [undefined, null, "", "   "]) {
      expect(cargoDeVinculoDesdeTexto(texto), String(texto)).toEqual({ ok: true, valor: null });
    }
  });

  it("una línea con letras, recortada, hasta 100 caracteres", () => {
    expect(cargoDeVinculoDesdeTexto("  Encargado de cocina ")).toEqual({
      ok: true,
      valor: "Encargado de cocina",
    });
    expect(LARGO_MAXIMO_DEL_CARGO_DE_VINCULO).toBe(100);
    expect(cargoDeVinculoDesdeTexto("C".repeat(100)).ok).toBe(true);
    expect(cargoDeVinculoDesdeTexto("C".repeat(101))).toEqual({
      ok: false,
      error: "CARGO_INVALIDO",
    });
  });

  it("rechaza lo que no es una línea de texto con letras", () => {
    for (const texto of ["123", "<b>", "Ventas\nCompras"]) {
      expect(cargoDeVinculoDesdeTexto(texto), texto).toEqual({
        ok: false,
        error: "CARGO_INVALIDO",
      });
    }
  });
});
