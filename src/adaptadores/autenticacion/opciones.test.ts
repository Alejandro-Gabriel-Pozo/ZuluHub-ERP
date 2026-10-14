import { describe, expect, it } from "vitest";
import {
  ENCABEZADO_DE_IP,
  configuracionDeHost,
} from "../../capacidades/autenticacion/host-de-autenticacion";
import { LIMITES_DE_SESION } from "../../capacidades/autenticacion/vigencia-de-sesion";
import { opcionesDeInstancia, type ParametrosDeInstancia } from "./opciones";

/**
 * Lo que la configuración de la librería FIJA para los hallazgos S1, S3 y M1 de la revisión del PR #48. El
 * comportamiento real contra la librería está en `test/integracion/autenticacion-ingreso.test.ts`; acá se
 * fijan las opciones para que quitarlas rompa una prueba sin necesidad de base.
 */
function opciones(extra: Partial<ParametrosDeInstancia> = {}) {
  const c = configuracionDeHost("app.marca-a.test");
  if (!c.ok) throw new Error("host inválido");
  return opcionesDeInstancia({
    configuracion: c.valor,
    db: {} as never,
    secreto: "x".repeat(40),
    google: { clientId: "id", clientSecret: "reservado" },
    limites: LIMITES_DE_SESION,
    reloj: () => new Date(0),
    rutaDeError: "/ingreso",
    registrar: () => undefined,
    ...extra,
  });
}

describe("opcionesDeInstancia", () => {
  it("S1: el proveedor de Google no acepta un idToken mandado por el cliente", () => {
    const google = opciones().socialProviders?.google as { disableIdTokenSignIn?: boolean };
    expect(google.disableIdTokenSignIn).toBe(true);
  });

  it("S3: la IP del límite sale de UN encabezado de confianza, y no de x-forwarded-for", () => {
    const ip = opciones().advanced?.ipAddress;
    expect(ip?.ipAddressHeaders).toEqual([ENCABEZADO_DE_IP]);
    expect(ip?.ipAddressHeaders).not.toContain("x-forwarded-for");
    expect(ip?.disableIpTracking).toBeUndefined();
    expect(ip?.trustedProxies).toBeUndefined();
  });

  it("S3: el nombre del encabezado de confianza es configurable (un nombre, no un secreto)", () => {
    const ip = opciones({ encabezadoDeIp: "x-otro-encabezado" }).advanced?.ipAddress;
    expect(ip?.ipAddressHeaders).toEqual(["x-otro-encabezado"]);
  });

  it("M1: las cookies llevan __Host-: prefijo en el nombre, Secure, Path=/ y sin Domain", () => {
    const avanzado = opciones().advanced;
    expect(avanzado?.cookiePrefix).toBe("__Host-zh_emp");
    // La librería no antepone `__Secure-` (el nombre ya empieza con `__Host-`); `Secure` lo fija el atributo.
    expect(avanzado?.useSecureCookies).toBe(false);
    expect(avanzado?.defaultCookieAttributes).toMatchObject({ secure: true, path: "/" });
    expect(avanzado?.defaultCookieAttributes).not.toHaveProperty("domain");
    expect(avanzado?.crossSubDomainCookies).toBeUndefined();
  });
});
