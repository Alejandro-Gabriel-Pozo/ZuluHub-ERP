import { describe, expect, it } from "vitest";
import { RUTAS_PERMITIDAS, rutaPermitida } from "./rutas-permitidas";

describe("RUTAS_PERMITIDAS: la lista cerrada", () => {
  it("son exactamente cuatro, con su método", () => {
    expect(RUTAS_PERMITIDAS).toEqual([
      { metodo: "POST", ruta: "/api/auth/sign-in/social" },
      { metodo: "GET", ruta: "/api/auth/callback/google" },
      { metodo: "GET", ruta: "/api/auth/get-session" },
      { metodo: "POST", ruta: "/api/auth/sign-out" },
    ]);
  });

  it("no se puede agregar nada en tiempo de ejecución", () => {
    expect(Object.isFrozen(RUTAS_PERMITIDAS)).toBe(true);
  });
});

describe("rutaPermitida", () => {
  it.each(RUTAS_PERMITIDAS.map((r) => [r.metodo, r.ruta] as const))(
    "%s %s pasa",
    (metodo, ruta) => {
      expect(rutaPermitida(metodo, ruta)).toBe(true);
    },
  );

  it.each([
    ["GET", "/api/auth/sign-in/social"],
    ["POST", "/api/auth/callback/google"],
    ["POST", "/api/auth/get-session"],
    ["GET", "/api/auth/sign-out"],
    ["PUT", "/api/auth/sign-out"],
    ["HEAD", "/api/auth/get-session"],
    ["OPTIONS", "/api/auth/get-session"],
    ["get", "/api/auth/get-session"],
    ["", "/api/auth/get-session"],
  ])("%s %s no pasa: el método tiene que coincidir", (metodo, ruta) => {
    expect(rutaPermitida(metodo, ruta)).toBe(false);
  });

  it.each([
    "/api/auth/get-session/",
    "/api/auth/Get-Session",
    "/api/auth//get-session",
    "/api/auth/get-session%2F",
    "/api/auth/callback/otro",
    "/api/auth/callback/google/",
    "/api/auth/callback/",
    "/api/auth/sign-in/email",
    "/api/auth/reset-password/token",
    "/api/auth/two-factor/enable",
    "/api/auth",
    "/api/auth/",
    "/get-session",
    "api/auth/get-session",
    "/x/api/auth/get-session",
    "/api/auth/get-session/x",
    "",
  ])("la ruta %j no pasa", (ruta) => {
    expect(rutaPermitida("GET", ruta)).toBe(false);
    expect(rutaPermitida("POST", ruta)).toBe(false);
  });
});
