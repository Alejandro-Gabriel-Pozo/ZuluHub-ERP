import { describe, expect, it } from "vitest";
import { entradaDelCambioDeModulo } from "../../apps/plataforma/logica/entrada-del-modulo";

const VALIDA = {
  claveDeIdempotencia: "3f2b8c1e-5d4a-4b7e-9c1a-2e6f8a0b1c3d",
  empresaId: "0190a5c2-7b3e-7c11-8a2d-5f4e3d2c1b0a",
  modulo: "salon",
  activar: true,
};

describe("entradaDelCambioDeModulo", () => {
  it("forma válida: devuelve los cuatro campos", () => {
    expect(entradaDelCambioDeModulo(VALIDA)).toEqual({ ok: true, valor: VALIDA });
    expect(entradaDelCambioDeModulo({ ...VALIDA, activar: false })).toMatchObject({
      ok: true,
      valor: { activar: false },
    });
  });

  it("descarta las claves de más sin copiarlas", () => {
    const r = entradaDelCambioDeModulo({ ...VALIDA, tenantId: "x", rol: "ADMIN" });
    expect(r).toEqual({ ok: true, valor: VALIDA });
  });

  it.each([
    ["no es un objeto", "texto"],
    ["es null", null],
    ["es un arreglo", []],
    ["clave que no es uuid", { ...VALIDA, claveDeIdempotencia: "no-es-uuid" }],
    ["empresa que no es uuid", { ...VALIDA, empresaId: "123" }],
    ["falta la empresa", { ...VALIDA, empresaId: undefined }],
    ["módulo fuera del catálogo", { ...VALIDA, modulo: "inventado" }],
    ["módulo heredado del prototipo", { ...VALIDA, modulo: "constructor" }],
    ["módulo vacío", { ...VALIDA, modulo: "" }],
    ["módulo que no es texto", { ...VALIDA, modulo: 3 }],
    ["activar como texto", { ...VALIDA, activar: "true" }],
    ["activar ausente", { ...VALIDA, activar: undefined }],
  ])("rechaza: %s", (_motivo, entrada) => {
    expect(entradaDelCambioDeModulo(entrada)).toEqual({ ok: false });
  });
});
