import { describe, expect, it } from "vitest";
import { emailDesdeTexto } from "./email";

describe("email", () => {
  it("normaliza: sin espacios en los extremos y en minúsculas", () => {
    expect(emailDesdeTexto("  Ana@X.com ")).toEqual({ ok: true, valor: "ana@x.com" });
    expect(emailDesdeTexto("ANA@X.COM")).toEqual({ ok: true, valor: "ana@x.com" });
    expect(emailDesdeTexto("\tana@x.com\n")).toEqual({ ok: true, valor: "ana@x.com" });
  });

  it("aplica la misma regla que el CHECK persona_email_ck: un carácter antes y uno después de la @", () => {
    for (const valido of ["a@b", "ana@x.com", "a.b+c@sub.dominio.com.ar", "a@@b", "@@a", "a@@"]) {
      expect(emailDesdeTexto(valido)).toEqual({ ok: true, valor: valido });
    }
    for (const invalido of ["", "   ", "@", "@a", "a@", "@@", "ana", "ana.x.com"]) {
      expect(emailDesdeTexto(invalido)).toEqual({ ok: false, error: "EMAIL_INVALIDO" });
    }
  });

  it("el único @ en el extremo no vale aunque haya otras cosas", () => {
    expect(emailDesdeTexto("@ana")).toEqual({ ok: false, error: "EMAIL_INVALIDO" });
    expect(emailDesdeTexto("ana@")).toEqual({ ok: false, error: "EMAIL_INVALIDO" });
    expect(emailDesdeTexto(" @ana ")).toEqual({ ok: false, error: "EMAIL_INVALIDO" });
    expect(emailDesdeTexto(" ana@ ")).toEqual({ ok: false, error: "EMAIL_INVALIDO" });
  });

  it("rechaza espacios, tabulaciones y saltos de línea internos (más prudente que la base)", () => {
    for (const invalido of [
      "a na@x.com",
      "ana@x .com",
      "ana\t@x.com",
      "ana@x.com\nb@y.com",
      "ana\r@x.com",
    ]) {
      expect(emailDesdeTexto(invalido)).toEqual({ ok: false, error: "EMAIL_INVALIDO" });
    }
  });

  it("es idempotente: normalizar lo normalizado no cambia nada", () => {
    const primero = emailDesdeTexto("  Ana@X.com ");
    expect(primero.ok && emailDesdeTexto(primero.valor)).toEqual(primero);
  });
});
