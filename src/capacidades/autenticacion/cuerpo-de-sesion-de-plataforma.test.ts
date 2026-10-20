import { describe, expect, it } from "vitest";
import { cuerpoPublicoDeSesionDePlataforma } from "./cuerpo-de-sesion-de-plataforma";
import { SIN_SESION_DE_PLATAFORMA } from "./estado-de-sesion-de-plataforma";
import { LIMITES_DE_SESION } from "./vigencia-de-sesion";

const MINUTO = 60_000;
const AHORA = new Date("2026-10-20T12:00:00.000Z");
const hace = (ms: number) => new Date(AHORA.getTime() - ms).toISOString();
const dentroDe = (ms: number) => new Date(AHORA.getTime() + ms).toISOString();

const cuerpo = (session: object | null, extra: object = {}) =>
  JSON.stringify({ session, user: { id: "u", email: "x@ejemplo.test" }, ...extra });

const sesion = (o: Record<string, unknown> = {}) => ({
  token: "token-de-sesion",
  createdAt: hace(5 * MINUTO),
  updatedAt: hace(MINUTO),
  expiresAt: dentroDe(29 * MINUTO),
  segundoFactorEn: hace(MINUTO),
  ...o,
});

describe("cuerpoPublicoDeSesionDePlataforma", () => {
  it("de la sesión de la librería sale solo el estado: ni el token ni el usuario", () => {
    const salida = cuerpoPublicoDeSesionDePlataforma(cuerpo(sesion()), AHORA);
    expect(salida).toEqual({
      vigente: true,
      venceEnMs: 29 * MINUTO,
      motivo: "INACTIVIDAD",
      segundoFactorRecienteHastaMs: 4 * MINUTO,
    });
    expect(Object.keys(salida).sort()).toEqual([
      "motivo",
      "segundoFactorRecienteHastaMs",
      "venceEnMs",
      "vigente",
    ]);
  });

  it("sin segundo factor en la sesión (ausente o nulo), la ventana es 0", () => {
    expect(
      cuerpoPublicoDeSesionDePlataforma(cuerpo(sesion({ segundoFactorEn: null })), AHORA)
        .segundoFactorRecienteHastaMs,
    ).toBe(0);
    const sin = sesion();
    delete (sin as Record<string, unknown>)["segundoFactorEn"];
    expect(cuerpoPublicoDeSesionDePlataforma(cuerpo(sin), AHORA).segundoFactorRecienteHastaMs).toBe(
      0,
    );
  });

  it("una fecha que no es un texto o no se entiende deja el campo en nulo: nunca inventa una ventana", () => {
    expect(
      cuerpoPublicoDeSesionDePlataforma(cuerpo(sesion({ segundoFactorEn: 12345 })), AHORA)
        .segundoFactorRecienteHastaMs,
    ).toBe(0);
    expect(
      cuerpoPublicoDeSesionDePlataforma(cuerpo(sesion({ segundoFactorEn: "ayer" })), AHORA)
        .segundoFactorRecienteHastaMs,
    ).toBe(0);
  });

  it("vencida: no vigente, con el motivo", () => {
    expect(
      cuerpoPublicoDeSesionDePlataforma(
        cuerpo(sesion({ updatedAt: hace(31 * MINUTO), expiresAt: hace(MINUTO) })),
        AHORA,
      ),
    ).toEqual({
      vigente: false,
      venceEnMs: 0,
      motivo: "INACTIVIDAD",
      segundoFactorRecienteHastaMs: 0,
    });
  });

  it("usa los límites que se le pasen", () => {
    // Usada hace 20 minutos: vigente con los de la consola, vencida con los de empresa (15).
    const s = cuerpo(sesion({ updatedAt: hace(20 * MINUTO), expiresAt: dentroDe(10 * MINUTO) }));
    expect(cuerpoPublicoDeSesionDePlataforma(s, AHORA).vigente).toBe(true);
    expect(cuerpoPublicoDeSesionDePlataforma(s, AHORA, LIMITES_DE_SESION).vigente).toBe(false);
  });

  it.each([
    ["null (sin sesión)", "null"],
    ["session nula", cuerpo(null)],
    ["session que no es un objeto", JSON.stringify({ session: "x" })],
    ["sin session", JSON.stringify({ user: {} })],
    ["sin createdAt", cuerpo(sesion({ createdAt: undefined }))],
    ["sin updatedAt", cuerpo(sesion({ updatedAt: undefined }))],
    ["sin expiresAt", cuerpo(sesion({ expiresAt: undefined }))],
    ["createdAt inválida", cuerpo(sesion({ createdAt: "ayer" }))],
    ["updatedAt que no es texto", cuerpo(sesion({ updatedAt: 5 }))],
    ["expiresAt inválida", cuerpo(sesion({ expiresAt: "mañana" }))],
    ["no es JSON", "no es json"],
    ["vacío", ""],
  ])("lo que no se entiende (%s) es «sin sesión»", (_c, texto) => {
    expect(cuerpoPublicoDeSesionDePlataforma(texto, AHORA)).toEqual(SIN_SESION_DE_PLATAFORMA);
  });
});

describe("las fechas tienen que ser texto (un número no se toma como fecha)", () => {
  it.each(["createdAt", "updatedAt", "expiresAt"])("%s numérico: sin sesión", (campo) => {
    expect(
      cuerpoPublicoDeSesionDePlataforma(cuerpo(sesion({ [campo]: AHORA.getTime() })), AHORA),
    ).toEqual(SIN_SESION_DE_PLATAFORMA);
  });

  it("segundoFactorEn numérico es como no tenerlo (no hay segundo factor reciente)", () => {
    const salida = cuerpoPublicoDeSesionDePlataforma(
      cuerpo(sesion({ segundoFactorEn: AHORA.getTime() })),
      AHORA,
    );
    expect(salida.vigente).toBe(true);
    expect(salida.segundoFactorRecienteHastaMs).toBe(0);
  });
});
