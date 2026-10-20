import { describe, expect, it } from "vitest";
import { hostGuardado, segundoFactorEnDe, segundoFactorEnroladoDe } from "./sesion-leida";

describe("hostGuardado", () => {
  it("lee el host de la sesión y, si no se puede leer, devuelve vacío (no coincide con ningún host)", () => {
    expect(hostGuardado({ host: "consola.example.test" })).toBe("consola.example.test");
    expect(hostGuardado({})).toBe("");
    expect(hostGuardado({ host: 5 })).toBe("");
    expect(hostGuardado({ host: null })).toBe("");
    expect(hostGuardado({ host: undefined })).toBe("");
  });
});

describe("segundoFactorEnDe", () => {
  const f = new Date("2026-10-20T12:00:00.000Z");

  it("lee una fecha (de la base) o un texto ISO (del cuerpo JSON de la librería)", () => {
    expect(segundoFactorEnDe({ segundoFactorEn: f })).toEqual(f);
    expect(segundoFactorEnDe({ segundoFactorEn: f.toISOString() })).toEqual(f);
  });

  it("lo que no se entiende es nulo (sin segundo factor): ausente, nulo, fechas inválidas, números y otros tipos", () => {
    for (const x of [
      {},
      { segundoFactorEn: null },
      { segundoFactorEn: undefined },
      { segundoFactorEn: new Date("x") },
      { segundoFactorEn: "ayer" },
      { segundoFactorEn: "" },
      { segundoFactorEn: 1760961600000 },
      { segundoFactorEn: true },
      { segundoFactorEn: {} },
    ]) {
      expect(segundoFactorEnDe(x), JSON.stringify(x)).toBeNull();
    }
  });
});

describe("segundoFactorEnroladoDe", () => {
  it("solo un true de verdad es «enrolado»", () => {
    expect(segundoFactorEnroladoDe({ twoFactorEnabled: true })).toBe(true);
    for (const x of [
      {},
      { twoFactorEnabled: false },
      { twoFactorEnabled: null },
      { twoFactorEnabled: undefined },
      { twoFactorEnabled: "true" },
      { twoFactorEnabled: 1 },
      { twoFactorEnabled: {} },
    ]) {
      expect(segundoFactorEnroladoDe(x), JSON.stringify(x)).toBe(false);
    }
  });
});
