import { describe, expect, it } from "vitest";
import { cuerpoPublicoDeSesion } from "./cuerpo-de-sesion";

const SESION = {
  session: {
    expiresAt: "2026-10-13T12:15:00.000Z",
    updatedAt: "2026-10-13T12:00:00.000Z",
    createdAt: "2026-10-13T09:00:00.000Z",
    token: "TOKEN-QUE-NO-SALE",
    userId: "u1",
    host: "app.marca-a.test",
  },
  user: { id: "u1", email: "ana@ejemplo.test", name: "Ana" },
};

describe("cuerpoPublicoDeSesion", () => {
  it("con sesión: solo si está vigente, hasta cuándo y desde cuándo no se usa", () => {
    expect(cuerpoPublicoDeSesion(JSON.stringify(SESION))).toEqual({
      vigente: true,
      venceEn: "2026-10-13T12:15:00.000Z",
      ultimoUso: "2026-10-13T12:00:00.000Z",
    });
  });

  it("nada del token, del usuario ni del host llega al navegador", () => {
    const salida = JSON.stringify(cuerpoPublicoDeSesion(JSON.stringify(SESION)));
    expect(salida).not.toContain("TOKEN-QUE-NO-SALE");
    expect(salida).not.toContain("ana@ejemplo.test");
    expect(salida).not.toContain("app.marca-a.test");
    expect(Object.keys(cuerpoPublicoDeSesion(JSON.stringify(SESION))).sort()).toEqual([
      "ultimoUso",
      "venceEn",
      "vigente",
    ]);
  });

  it("normaliza las fechas a ISO", () => {
    const r = cuerpoPublicoDeSesion(
      JSON.stringify({
        session: { expiresAt: "2026-10-13T12:15:00Z", updatedAt: "2026-10-13T12:00:00+00:00" },
      }),
    );
    expect(r).toEqual({
      vigente: true,
      venceEn: "2026-10-13T12:15:00.000Z",
      ultimoUso: "2026-10-13T12:00:00.000Z",
    });
  });

  it.each([
    ["la librería sin sesión (null)", "null"],
    ["un objeto sin sesión", "{}"],
    ["un objeto con la sesión nula", '{"session":null}'],
    ["una sesión que no es objeto", '{"session":"x"}'],
    ["una sesión sin vencimiento", '{"session":{"updatedAt":"2026-10-13T12:00:00Z"}}'],
    ["una sesión sin último uso", '{"session":{"expiresAt":"2026-10-13T12:00:00Z"}}'],
    [
      "un vencimiento que no es texto",
      '{"session":{"expiresAt":123,"updatedAt":"2026-10-13T12:00:00Z"}}',
    ],
    [
      "un último uso que no es texto",
      '{"session":{"expiresAt":"2026-10-13T12:00:00Z","updatedAt":null}}',
    ],
    [
      "un vencimiento inválido",
      '{"session":{"expiresAt":"mañana","updatedAt":"2026-10-13T12:00:00Z"}}',
    ],
    [
      "un último uso inválido",
      '{"session":{"expiresAt":"2026-10-13T12:00:00Z","updatedAt":"ayer"}}',
    ],
    ["un arreglo", "[]"],
    ["texto que no es JSON", "<html>"],
    ["vacío", ""],
  ])("%s: no hay sesión vigente", (_nombre, cuerpo) => {
    expect(cuerpoPublicoDeSesion(cuerpo)).toEqual({ vigente: false });
  });
});
