import { describe, expect, it } from "vitest";
import {
  ENCABEZADOS_DE_RESPUESTA,
  RUTA_NEUTRA,
  decidirPuerta,
  normalizarHost,
  sinEncabezadosInternos,
} from "./puerta";

describe("normalizarHost", () => {
  it.each([
    ["Ejemplo.COM", "ejemplo.com"],
    ["  ejemplo.com  ", "ejemplo.com"],
    ["ejemplo.com:3000", "ejemplo.com"],
    ["ejemplo.com:", "ejemplo.com"],
    ["ejemplo.com.", "ejemplo.com"],
    ["ejemplo.com..", "ejemplo.com"],
    ["ejemplo.com.:443", "ejemplo.com"],
    ["[::1]:3000", "[::1]"],
    ["[::1]", "[::1]"],
    ["127.0.0.1:8080", "127.0.0.1"],
    ["", ""],
    ["   ", ""],
  ])("%j → %j", (crudo, esperado) => {
    expect(normalizarHost(crudo)).toBe(esperado);
  });

  it("sin host devuelve vacío", () => {
    expect(normalizarHost(null)).toBe("");
    expect(normalizarHost(undefined)).toBe("");
  });
});

describe("sinEncabezadosInternos", () => {
  it("descarta todo x-zh-*, sin importar mayúsculas, y conserva el resto", () => {
    const entrantes = new Headers([
      ["X-ZH-Marca", "otra"],
      ["x-zh-superficie", "app"],
      ["x-zh-", "vacio"],
      ["host", "ejemplo.com"],
      ["accept", "text/html"],
      ["x-zhx", "no es interno"],
      ["x-otro-zh-marca", "tampoco"],
      ["cookie", "a=1"],
      ["cookie", "b=2"],
    ]);
    const limpios = sinEncabezadosInternos(entrantes);
    expect([...limpios.keys()].sort()).toEqual([
      "accept",
      "cookie",
      "host",
      "x-otro-zh-marca",
      "x-zhx",
    ]);
    expect(limpios.get("host")).toBe("ejemplo.com");
  });

  it("no modifica el original ni devuelve la misma instancia", () => {
    const entrantes = new Headers([["x-zh-marca", "otra"]]);
    const limpios = sinEncabezadosInternos(entrantes);
    expect(limpios).not.toBe(entrantes);
    expect(entrantes.get("x-zh-marca")).toBe("otra");
    expect(limpios.has("x-zh-marca")).toBe(false);
  });
});

describe("decidirPuerta (W0: todo a la neutra)", () => {
  it.each([
    "ejemplo.com",
    "app.hotel-del-lago.com.ar",
    "zuluhub-erp.vercel.app",
    "10.0.0.1",
    "",
    "EJEMPLO.com:8443",
  ])("el host %j va a la neutra con noindex", (host) => {
    const entrantes = new Headers();
    if (host !== "") entrantes.set("host", host);
    const d = decidirPuerta(entrantes);
    expect(d.rutaInterna).toBe(RUTA_NEUTRA);
    expect(d.rutaInterna).toBe("/s/neutra");
    expect(d.encabezadosDeRespuesta).toEqual({ "X-Robots-Tag": "noindex" });
    expect(d.host).toBe(normalizarHost(host));
  });

  it("un x-zh-* del cliente no llega al pedido que sigue", () => {
    const d = decidirPuerta(
      new Headers([
        ["host", "a.com"],
        ["x-zh-marca", "b"],
        ["x-zh-host", "b.com"],
      ]),
    );
    expect([...d.encabezadosDePedido.keys()]).toEqual(["host"]);
  });

  it("la identidad es el host: X-Forwarded-Host no la cambia", () => {
    const d = decidirPuerta(
      new Headers([
        ["host", "a.com"],
        ["x-forwarded-host", "b.com"],
      ]),
    );
    expect(d.host).toBe("a.com");
  });

  it("las constantes públicas son las esperadas y no se pueden mutar", () => {
    expect(ENCABEZADOS_DE_RESPUESTA["X-Robots-Tag"]).toBe("noindex");
    expect(Object.isFrozen(ENCABEZADOS_DE_RESPUESTA)).toBe(true);
  });
});
