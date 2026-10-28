import { describe, expect, it } from "vitest";
import {
  entradaDelCambioDePlan,
  LARGO_MAXIMO_DEL_MOTIVO,
} from "../../apps/plataforma/logica/entrada-del-plan";
import { LARGO_MAXIMO_DEL_MOTIVO as LARGO_DEL_BACKEND } from "../../src/plataforma/dominio/formas-de-entrada";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const U3 = "33333333-3333-4333-8333-333333333333";

const buena = {
  claveDeIdempotencia: U1,
  tenantId: U2,
  versionDePlanId: U3,
  vigenteDesde: "2026-11-01",
  motivo: "  Pasa al plan Pro  ",
  numeroEsperado: 3,
  reemplazaProgramada: false,
};

describe("entradaDelCambioDePlan", () => {
  it("acepta la forma buena y recorta el motivo", () => {
    const r = entradaDelCambioDePlan(buena);
    expect(r).toEqual({ ok: true, valor: { ...buena, motivo: "Pasa al plan Pro" } });
  });
  it("acepta numeroEsperado null y 1; rechaza 0 (el backend lo rechaza: la serie empieza en 1)", () => {
    expect(entradaDelCambioDePlan({ ...buena, numeroEsperado: null }).ok).toBe(true);
    expect(entradaDelCambioDePlan({ ...buena, numeroEsperado: 1 }).ok).toBe(true);
    expect(entradaDelCambioDePlan({ ...buena, numeroEsperado: 0 }).ok).toBe(false);
  });
  it("el largo máximo del motivo es el del backend", () => {
    expect(LARGO_MAXIMO_DEL_MOTIVO).toBe(LARGO_DEL_BACKEND);
  });
  it.each([null, undefined, [], [buena], "texto", 5])("rechaza %j", (x) => {
    expect(entradaDelCambioDePlan(x)).toEqual({ ok: false });
  });
  it.each(["claveDeIdempotencia", "tenantId", "versionDePlanId"])(
    "rechaza %s que no es UUID",
    (c) => {
      expect(entradaDelCambioDePlan({ ...buena, [c]: "no-es-uuid" }).ok).toBe(false);
      expect(entradaDelCambioDePlan({ ...buena, [c]: 7 }).ok).toBe(false);
    },
  );
  it.each(["2026-02-30", "2026-1-1", "mañana", "", 20261101])("rechaza la fecha %j", (f) => {
    expect(entradaDelCambioDePlan({ ...buena, vigenteDesde: f }).ok).toBe(false);
  });
  it("rechaza motivo vacío, de espacios, largo o no texto", () => {
    expect(entradaDelCambioDePlan({ ...buena, motivo: "" }).ok).toBe(false);
    expect(entradaDelCambioDePlan({ ...buena, motivo: "   " }).ok).toBe(false);
    expect(entradaDelCambioDePlan({ ...buena, motivo: "a".repeat(501) }).ok).toBe(false);
    expect(entradaDelCambioDePlan({ ...buena, motivo: "a".repeat(500) }).ok).toBe(true);
    expect(entradaDelCambioDePlan({ ...buena, motivo: 4 }).ok).toBe(false);
  });
  it.each([-1, 1.5, "3", undefined, Number.NaN])("rechaza numeroEsperado %j", (n) => {
    expect(entradaDelCambioDePlan({ ...buena, numeroEsperado: n }).ok).toBe(false);
  });
  it.each(["true", 1, null, undefined])("rechaza reemplazaProgramada %j", (v) => {
    expect(entradaDelCambioDePlan({ ...buena, reemplazaProgramada: v }).ok).toBe(false);
  });
  it("descarta las claves de más", () => {
    const r = entradaDelCambioDePlan({ ...buena, rol: "ADMIN", extra: { a: 1 } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.valor).sort()).toEqual(Object.keys(buena).sort());
  });
});
