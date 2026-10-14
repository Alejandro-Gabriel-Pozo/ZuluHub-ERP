import { describe, expect, it } from "vitest";
import { origenEsPropio } from "./origen";

describe("origenEsPropio (P-7)", () => {
  const HOST = "app.hoteldellago.test";

  it("el origen de la propia aplicación pasa", () => {
    expect(origenEsPropio(`https://${HOST}`, HOST)).toBe(true);
  });

  it("no distingue mayúsculas del host del pedido", () => {
    expect(origenEsPropio(`https://${HOST}`, "App.HotelDelLago.test")).toBe(true);
  });

  it.each([
    ["otro host", "https://app.panaderialospinos.test"],
    ["un host que lo contiene", `https://${HOST}.malo.test`],
    ["un subdominio", `https://x.${HOST}`],
    ["otro puerto", `https://${HOST}:8443`],
    ["http", `http://${HOST}`],
    ["null (documento aislado)", "null"],
    ["ilegible", "no es una url"],
    ["vacío", ""],
    ["otro esquema", `ftp://${HOST}`],
  ])("rechaza %s", (_nombre, origen) => {
    expect(origenEsPropio(origen, HOST)).toBe(false);
  });

  it("el puerto del host del pedido cuenta (se compara host:puerto)", () => {
    expect(origenEsPropio(`https://${HOST}:8443`, `${HOST}:8443`)).toBe(true);
    expect(origenEsPropio(`https://${HOST}`, `${HOST}:8443`)).toBe(false);
  });

  it("sin origen (un cliente que no es un navegador) se deja pasar: lo cubre SameSite=Lax", () => {
    expect(origenEsPropio(null, HOST)).toBe(true);
  });

  it("sin host nada coincide", () => {
    expect(origenEsPropio(`https://${HOST}`, "")).toBe(false);
    expect(origenEsPropio("https://", "")).toBe(false);
  });
});
