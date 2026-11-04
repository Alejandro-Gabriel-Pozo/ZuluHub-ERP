import { describe, expect, it } from "vitest";
import { entradaDelAlta } from "../../apps/plataforma/logica/entrada-del-alta";

const UUID_V4 = "3f2b8c1e-5d4a-4b7e-9c1a-2e6f8a0b1c3d";
const UUID_V7 = "0190a5c2-7b3e-7c11-8a2d-5f4e3d2c1b0a";

const BUENA = {
  claveDeIdempotencia: UUID_V4,
  razonSocial: "Panadería La Espiga S.A.",
  cuit: "30-71234567-1",
  marcaId: UUID_V7,
  versionDePlanId: UUID_V4,
  emailGerente: "gerente@laespiga.com.ar",
  zonaHoraria: "America/Argentina/Buenos_Aires",
};

describe("entradaDelAlta: la forma de lo que manda el navegador", () => {
  it("acepta la forma buena y devuelve los siete campos", () => {
    expect(entradaDelAlta(BUENA)).toEqual({ ok: true, valor: BUENA });
  });

  it("acepta versionDePlanId null y UUID en mayúsculas", () => {
    const r = entradaDelAlta({
      ...BUENA,
      versionDePlanId: null,
      claveDeIdempotencia: UUID_V4.toUpperCase(),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valor.versionDePlanId).toBeNull();
  });

  it.each([null, undefined, [], [BUENA], "texto", 7, true])("rechaza %j", (entrada) => {
    expect(entradaDelAlta(entrada)).toEqual({ ok: false });
  });

  it.each([
    ["no es UUID", "no-soy-un-uuid"],
    ["UUID sin guiones", UUID_V4.replaceAll("-", "")],
    ["UUID con basura al final", `${UUID_V4}x`],
    ["vacía", ""],
  ])("rechaza una clave de idempotencia que %s", (_c, clave) => {
    expect(entradaDelAlta({ ...BUENA, claveDeIdempotencia: clave })).toEqual({ ok: false });
  });

  it.each([
    ["razonSocial", 201],
    ["cuit", 21],
    ["emailGerente", 255],
    ["zonaHoraria", 65],
  ])("rechaza %s con largo excesivo, pero acepta el máximo", (campo, largo) => {
    expect(entradaDelAlta({ ...BUENA, [campo]: "a".repeat(largo) })).toEqual({ ok: false });
    expect(entradaDelAlta({ ...BUENA, [campo]: "a".repeat(largo - 1) }).ok).toBe(true);
  });

  it.each(["razonSocial", "cuit", "emailGerente", "zonaHoraria"])("rechaza %s vacío", (campo) => {
    expect(entradaDelAlta({ ...BUENA, [campo]: "" })).toEqual({ ok: false });
  });

  it.each(Object.keys(BUENA))("rechaza si falta %s", (campo) => {
    const resto: Record<string, unknown> = { ...BUENA };
    delete resto[campo];
    expect(entradaDelAlta(resto)).toEqual({ ok: false });
  });

  it.each(["claveDeIdempotencia", "razonSocial", "cuit", "marcaId", "emailGerente", "zonaHoraria"])(
    "rechaza %s que no es texto",
    (campo) => {
      for (const malo of [123, true, null, {}, [], ["x"], { toString: () => UUID_V4 }]) {
        expect(entradaDelAlta({ ...BUENA, [campo]: malo })).toEqual({ ok: false });
      }
    },
  );

  it.each([
    ["texto que no es UUID", "plan-1"],
    ["número", 5],
    ["vacío", ""],
    ["objeto anidado", { id: UUID_V4 }],
    ["arreglo", [UUID_V4]],
    ["undefined", undefined],
    ["false", false],
  ])("rechaza versionDePlanId con forma rara: %s", (_c, plan) => {
    expect(entradaDelAlta({ ...BUENA, versionDePlanId: plan })).toEqual({ ok: false });
  });

  it("ignora los campos extra: no los copia al valor", () => {
    const r = entradaDelAlta({
      ...BUENA,
      tenantId: UUID_V4,
      moneda: "USD",
      nombreDeTenant: "otro",
      __proto__: { admin: true },
      anidado: { a: 1 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(r.valor).sort()).toEqual(Object.keys(BUENA).sort());
      expect(r.valor).toEqual(BUENA);
    }
  });
});
