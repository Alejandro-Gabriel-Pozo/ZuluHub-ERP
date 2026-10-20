import { describe, expect, it } from "vitest";
import {
  RUTAS_PERMITIDAS,
  RUTAS_PERMITIDAS_DE_PLATAFORMA,
  RUTA_DE_ESTADO_DE_SESION,
  rutaPermitida,
  rutaPermitidaDePlataforma,
} from "./rutas-permitidas";

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

describe("RUTAS_PERMITIDAS_DE_PLATAFORMA: la lista cerrada de la consola (h5-p8 §3)", () => {
  it("son las cuatro de empresa más el estado de sesión y las cuatro del segundo factor, con su método", () => {
    expect(RUTAS_PERMITIDAS_DE_PLATAFORMA).toEqual([
      { metodo: "POST", ruta: "/api/auth/sign-in/social" },
      { metodo: "GET", ruta: "/api/auth/callback/google" },
      { metodo: "GET", ruta: "/api/auth/get-session" },
      { metodo: "POST", ruta: "/api/auth/sign-out" },
      { metodo: "GET", ruta: "/api/auth/estado-de-sesion" },
      { metodo: "POST", ruta: "/api/auth/two-factor/enable" },
      { metodo: "POST", ruta: "/api/auth/two-factor/verify-totp" },
      { metodo: "POST", ruta: "/api/auth/two-factor/verify-backup-code" },
      { metodo: "POST", ruta: "/api/auth/two-factor/generate-backup-codes" },
    ]);
    expect(RUTA_DE_ESTADO_DE_SESION).toBe("/api/auth/estado-de-sesion");
  });

  it("no se puede agregar nada en tiempo de ejecución", () => {
    expect(Object.isFrozen(RUTAS_PERMITIDAS_DE_PLATAFORMA)).toBe(true);
  });

  it("NO incluye ver el secreto, dar de baja el TOTP ni el código por mail o SMS (el dueño resuelve la pérdida por script)", () => {
    const rutas = RUTAS_PERMITIDAS_DE_PLATAFORMA.map((r) => r.ruta);
    for (const cerrada of [
      "/api/auth/two-factor/get-totp-uri",
      "/api/auth/two-factor/disable",
      "/api/auth/two-factor/send-otp",
      "/api/auth/two-factor/verify-otp",
    ]) {
      expect(rutas).not.toContain(cerrada);
    }
  });

  it("la consola deja pasar las de empresa y la web de empresa NO deja pasar las del segundo factor ni el estado", () => {
    for (const r of RUTAS_PERMITIDAS)
      expect(rutaPermitidaDePlataforma(r.metodo, r.ruta)).toBe(true);
    for (const r of RUTAS_PERMITIDAS_DE_PLATAFORMA.slice(RUTAS_PERMITIDAS.length)) {
      expect(rutaPermitida(r.metodo, r.ruta), `${r.metodo} ${r.ruta}`).toBe(false);
    }
  });
});

describe("rutaPermitidaDePlataforma", () => {
  it.each(RUTAS_PERMITIDAS_DE_PLATAFORMA.map((r) => [r.metodo, r.ruta] as const))(
    "%s %s pasa",
    (metodo, ruta) => {
      expect(rutaPermitidaDePlataforma(metodo, ruta)).toBe(true);
    },
  );

  it.each([
    ["POST", "/api/auth/estado-de-sesion"],
    ["GET", "/api/auth/two-factor/enable"],
    ["GET", "/api/auth/two-factor/verify-totp"],
    ["PUT", "/api/auth/two-factor/verify-totp"],
    ["POST", "/api/auth/two-factor/get-totp-uri"],
    ["GET", "/api/auth/two-factor/get-totp-uri"],
    ["POST", "/api/auth/two-factor/disable"],
    ["POST", "/api/auth/two-factor/send-otp"],
    ["POST", "/api/auth/two-factor/verify-otp"],
    ["POST", "/api/auth/two-factor/enable/"],
    ["POST", "/api/auth/two-factor/Enable"],
    ["POST", "/api/auth/totp/generate"],
    ["POST", "/api/auth/sign-in/email"],
    ["post", "/api/auth/two-factor/verify-totp"],
    ["", "/api/auth/two-factor/verify-totp"],
    ["POST", ""],
  ])("%s %j no pasa", (metodo, ruta) => {
    expect(rutaPermitidaDePlataforma(metodo, ruta)).toBe(false);
  });
});
