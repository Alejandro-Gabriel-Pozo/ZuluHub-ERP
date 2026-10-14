import { describe, expect, it } from "vitest";
import { urlDeIngreso } from "./ingreso";

describe("urlDeIngreso", () => {
  it.each([
    ["app.hoteldellago.test", "https://app.hoteldellago.test/"],
    ["a.b", "https://a.b/"],
    ["a", "https://a/"],
    ["app-1.mi-marca.com.ar", "https://app-1.mi-marca.com.ar/"],
    ["xn--hotel-1ra.test", "https://xn--hotel-1ra.test/"],
    ["1.2.3.test", "https://1.2.3.test/"],
  ])("%j → %j", (host, esperado) => {
    expect(urlDeIngreso(host)).toBe(esperado);
  });

  it("sin host no hay enlace", () => {
    expect(urlDeIngreso(null)).toBeNull();
    expect(urlDeIngreso("")).toBeNull();
  });

  it.each([
    "App.Test",
    "app.test:8080",
    "app.test/",
    "app.test/x",
    "user@app.test",
    "app.test?x=1",
    "app.test#x",
    "//evil.test",
    "https://evil.test",
    ".app.test",
    "app.test.",
    "app..test",
    "-app.test",
    "app-.test",
    "app.-test",
    "app test",
    "app.test\n",
    "app_test.test",
    "app.tést",
    "[::1]",
    "javascript:alert(1)",
  ])("%j no se arma", (host) => {
    expect(urlDeIngreso(host)).toBeNull();
  });

  it("el largo máximo es el de un host (253)", () => {
    const etiqueta = "a".repeat(63);
    const ok253 = [etiqueta, etiqueta, etiqueta, "a".repeat(61)].join(".");
    expect(ok253).toHaveLength(253);
    expect(urlDeIngreso(ok253)).toBe(`https://${ok253}/`);
    expect(urlDeIngreso(`${ok253}a`)).toBeNull();
  });
});
