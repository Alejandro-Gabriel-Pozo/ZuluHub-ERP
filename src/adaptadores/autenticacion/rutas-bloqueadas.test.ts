import { describe, expect, it } from "vitest";
import { RUTAS_BLOQUEADAS, RUTAS_BLOQUEADAS_DE_PLATAFORMA } from "./rutas-bloqueadas";

describe("RUTAS_BLOQUEADAS", () => {
  it("es exactamente la lista de rutas de la librería que la aplicación no usa (cada texto, en su orden)", () => {
    expect(RUTAS_BLOQUEADAS).toEqual([
      "/sign-up/email",
      "/sign-in/email",
      "/reset-password",
      "/verify-password",
      "/verify-email",
      "/send-verification-email",
      "/change-email",
      "/change-password",
      "/update-session",
      "/update-user",
      "/delete-user",
      "/request-password-reset",
      "/reset-password/:token",
      "/list-sessions",
      "/revoke-session",
      "/revoke-sessions",
      "/revoke-other-sessions",
      "/link-social",
      "/list-accounts",
      "/delete-user/callback",
      "/unlink-account",
      "/refresh-token",
      "/get-access-token",
      "/account-info",
      "/ok",
      "/error",
    ]);
  });
});

describe("RUTAS_BLOQUEADAS_DE_PLATAFORMA", () => {
  it("son las de empresa más las del plugin twoFactor que la consola no usa (ver el secreto, dar de baja y el código por mail)", () => {
    expect(RUTAS_BLOQUEADAS_DE_PLATAFORMA).toEqual([
      ...RUTAS_BLOQUEADAS,
      "/two-factor/get-totp-uri",
      "/two-factor/disable",
      "/two-factor/send-otp",
      "/two-factor/verify-otp",
    ]);
  });

  it("no repite ninguna ruta ni bloquea las que la consola SÍ usa", () => {
    expect(new Set(RUTAS_BLOQUEADAS_DE_PLATAFORMA).size).toBe(
      RUTAS_BLOQUEADAS_DE_PLATAFORMA.length,
    );
    for (const usada of [
      "/two-factor/enable",
      "/two-factor/verify-totp",
      "/two-factor/verify-backup-code",
      "/two-factor/generate-backup-codes",
      "/estado-de-sesion",
      "/get-session",
      "/sign-out",
      "/sign-in/social",
    ]) {
      expect(RUTAS_BLOQUEADAS_DE_PLATAFORMA, usada).not.toContain(usada);
    }
  });
});
