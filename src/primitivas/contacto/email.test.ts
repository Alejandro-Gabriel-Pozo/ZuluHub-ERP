import { describe, expect, it } from "vitest";
import {
  LARGO_MAXIMO_DEL_EMAIL_DE_CONTACTO,
  emailDeContactoDesdeTexto,
  emailDesdeTexto,
} from "./email";

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

describe("emailDeContactoDesdeTexto (el correo como dato de contacto)", () => {
  const MALO = { ok: false, error: "EMAIL_INVALIDO" } as const;

  it("normaliza igual que emailDesdeTexto", () => {
    expect(emailDeContactoDesdeTexto("  Centro@Hotel.COM ")).toEqual({
      ok: true,
      valor: "centro@hotel.com",
    });
    expect(emailDeContactoDesdeTexto("a@b")).toEqual({ ok: true, valor: "a@b" });
    for (const invalido of ["", "centro", "@hotel.com", "centro@", "cen tro@hotel.com"]) {
      expect(emailDeContactoDesdeTexto(invalido)).toEqual(MALO);
    }
  });

  it("el borde: 254 caracteres entran y 255 no", () => {
    const de = (n: number) => `${"a".repeat(n - 6)}@b.com`;
    expect(emailDeContactoDesdeTexto(de(LARGO_MAXIMO_DEL_EMAIL_DE_CONTACTO)).ok).toBe(true);
    expect(emailDeContactoDesdeTexto(de(LARGO_MAXIMO_DEL_EMAIL_DE_CONTACTO + 1))).toEqual(MALO);
  });

  it("sin caracteres de control (que emailDesdeTexto, que es más amplio, sí deja pasar)", () => {
    for (const malo of ["a@b\u0085.com", "a@b\u001f.com", "a@b\u007f.com"]) {
      expect(emailDeContactoDesdeTexto(malo), JSON.stringify(malo)).toEqual(MALO);
    }
    // El comportamiento de siempre no cambió: sus llamadores (identidad, plataforma) no se endurecen.
    expect(emailDesdeTexto("a@b\u001f.com").ok).toBe(true);
    expect(emailDesdeTexto(`${"a".repeat(300)}@b.com`).ok).toBe(true);
  });
});
