import { describe, expect, it } from "vitest";
import {
  ENCABEZADO_DE_IP,
  PREFIJO_DE_COOKIE,
  PREFIJO_DE_COOKIE_DE_PLATAFORMA,
  PREFIJO_DE_NAVEGADOR,
  RUTA_BASE_DE_INGRESO,
  configuracionDeHost,
} from "./host-de-autenticacion";

describe("constantes", () => {
  it("el prefijo de cookie de la app de empresa y la ruta base de la librería", () => {
    expect(PREFIJO_DE_COOKIE).toBe("zh_emp");
    // La consola tiene el suyo: una cookie de una audiencia no es la de la otra.
    expect(PREFIJO_DE_COOKIE_DE_PLATAFORMA).toBe("zh_plat");
    expect(PREFIJO_DE_COOKIE_DE_PLATAFORMA).not.toBe(PREFIJO_DE_COOKIE);
    expect(RUTA_BASE_DE_INGRESO).toBe("/api/auth");
  });

  it("M1: las cookies de ingreso llevan __Host- (Secure, Path=/ y sin Domain)", () => {
    expect(PREFIJO_DE_NAVEGADOR).toBe("__Host-");
  });

  it("S3: el encabezado de IP de confianza es el fijado (NO VERIFICADO contra Vercel) y nunca x-forwarded-for", () => {
    expect(ENCABEZADO_DE_IP).toBe("x-vercel-forwarded-for");
    expect(ENCABEZADO_DE_IP).not.toBe("x-forwarded-for");
    expect(ENCABEZADO_DE_IP).toBe(ENCABEZADO_DE_IP.toLowerCase());
  });
});

describe("configuracionDeHost", () => {
  it("de un host sale su origen https fijo y esa es la única fuente confiable", () => {
    const r = configuracionDeHost("app.marca-a.test");
    expect(r).toEqual({
      ok: true,
      valor: {
        host: "app.marca-a.test",
        baseURL: "https://app.marca-a.test",
        origenesConfiables: ["https://app.marca-a.test"],
      },
    });
  });

  it.each([
    "localhost",
    "a",
    "a.b",
    "app.zuluhub.com.ar",
    "xn--caf-dma.example.com",
    "1a.test",
    "123.example.com",
    "a-b.c-d.test",
    "app.marca-a.test:3000",
    "app.test:1",
    "app.test:65535",
    "app.test:08080",
    "app.test1",
    "app.1a",
    "app.a1b",
  ])("acepta el host %j", (host) => {
    const r = configuracionDeHost(host);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valor.baseURL).toBe(`https://${host}`);
  });

  it.each([
    ["vacío", ""],
    ["solo un espacio", " "],
    ["con espacios", "app marca.test"],
    ["con blancos en los extremos", " app.test "],
    ["en mayúsculas (la puerta ya lo pasó a minúsculas)", "App.Test"],
    ["con esquema", "https://app.test"],
    ["con ruta", "app.test/x"],
    ["con usuario", "user@app.test"],
    ["con consulta", "app.test?x=1"],
    ["con barra invertida", "app.test\\x"],
    ["con punto final", "app.test."],
    ["con punto inicial", ".app.test"],
    ["con dos puntos seguidos", "app..test"],
    ["con guion bajo", "app_marca.test"],
    ["etiqueta que empieza con guion", "-a.test"],
    ["etiqueta que termina con guion", "a-.test"],
    ["etiqueta de 64 caracteres", `${"a".repeat(64)}.test`],
    ["IP v4", "127.0.0.1"],
    ["IP v4 con puerto", "203.0.113.5:3000"],
    ["IP v6", "[::1]"],
    ["número solo", "12345"],
    ["último tramo numérico", "app.123"],
    ["puerto cero", "app.test:0"],
    ["puerto 65536", "app.test:65536"],
    ["puerto de seis cifras", "app.test:100000"],
    ["puerto vacío", "app.test:"],
    ["puerto con letras", "app.test:80a"],
    ["no ASCII", "cafés.test"],
    ["salto de línea", "app.test\nx"],
  ])("rechaza un host %s", (_nombre, host) => {
    expect(configuracionDeHost(host)).toEqual({ ok: false, error: "HOST_INVALIDO" });
  });

  it("el largo máximo de un host es 253: ese sirve y uno más no", () => {
    const etiqueta = "a".repeat(63);
    const de253 = [etiqueta, etiqueta, etiqueta, "a".repeat(61)].join(".");
    expect(de253).toHaveLength(253);
    expect(configuracionDeHost(de253).ok).toBe(true);
    const de254 = [etiqueta, etiqueta, etiqueta, "a".repeat(62)].join(".");
    expect(de254).toHaveLength(254);
    expect(configuracionDeHost(de254)).toEqual({ ok: false, error: "HOST_INVALIDO" });
  });

  it("una etiqueta de 63 caracteres sirve", () => {
    expect(configuracionDeHost(`${"a".repeat(63)}.test`).ok).toBe(true);
  });
});
