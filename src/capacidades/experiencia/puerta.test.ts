import { describe, expect, it } from "vitest";
import { nonceDe } from "./cabeceras";
import {
  ENCABEZADO_DE_NONCE,
  HOST_DESCONOCIDO,
  HOST_NO_DISPONIBLE,
  PREFIJO_DE_ENCABEZADO_INTERNO,
  RUTA_INTERNA_DE,
  RUTA_NEUTRA,
  SUPERFICIES_SERVIBLES,
  decidirPuerta,
  hostDelPedido,
  sinEncabezadosInternos,
  type EstadoDeLaResolucion,
  type SuperficieServible,
} from "./puerta";

const NONCE = nonceDe(new Uint8Array(16).fill(7));

const resuelta = (superficie: SuperficieServible): EstadoDeLaResolucion => ({
  tipo: "RESUELTA",
  puerta: {
    host: "x.test",
    superficie,
    marcaId: "m1",
    marca: { nombre: "Marca", tema: {}, hostDeApp: null },
  },
});

const decidir = (
  ruta: string,
  resolucion: EstadoDeLaResolucion,
  encabezados: [string, string][] | Record<string, string> = {},
  produccion = false,
) =>
  decidirPuerta({
    encabezados: new Headers(encabezados),
    ruta,
    resolucion,
    produccion,
    nonce: NONCE,
  });

describe("constantes de la puerta", () => {
  it("son las esperadas", () => {
    expect(PREFIJO_DE_ENCABEZADO_INTERNO).toBe("x-zh-");
    expect(ENCABEZADO_DE_NONCE).toBe("x-zh-nonce");
    expect(RUTA_NEUTRA).toBe("/s/neutra");
    expect(SUPERFICIES_SERVIBLES).toEqual(["APP", "LANDING", "CARTA"]);
    expect(RUTA_INTERNA_DE).toEqual({ APP: "/s/app", LANDING: "/s/landing", CARTA: "/s/carta" });
    expect(Object.isFrozen(RUTA_INTERNA_DE)).toBe(true);
    expect(HOST_DESCONOCIDO).toEqual({ tipo: "DESCONOCIDO" });
    expect(HOST_NO_DISPONIBLE).toEqual({ tipo: "NO_DISPONIBLE" });
    expect(Object.isFrozen(HOST_DESCONOCIDO)).toBe(true);
    expect(Object.isFrozen(HOST_NO_DISPONIBLE)).toBe(true);
  });
});

describe("hostDelPedido", () => {
  it("es la cabecera host, tal cual llegó", () => {
    expect(hostDelPedido(new Headers({ host: "App.Ejemplo.com:8443" }))).toBe(
      "App.Ejemplo.com:8443",
    );
  });

  it("sin host es vacío", () => {
    expect(hostDelPedido(new Headers())).toBe("");
  });

  it("X-Forwarded-Host y los demás no cuentan, ni con host", () => {
    const encabezados = new Headers([
      ["host", "a.com"],
      ["x-forwarded-host", "b.com"],
      ["forwarded", "host=c.com"],
      ["x-original-host", "d.com"],
      ["x-zh-host", "e.com"],
    ] as [string, string][]);
    expect(hostDelPedido(encabezados)).toBe("a.com");
  });

  it("sin host pero con X-Forwarded-Host sigue siendo vacío", () => {
    expect(hostDelPedido(new Headers({ "x-forwarded-host": "b.com" }))).toBe("");
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

describe("decidirPuerta: a dónde va cada host", () => {
  it.each(SUPERFICIES_SERVIBLES)("%s se reescribe a su prefijo interno sin estado propio", (s) => {
    const d = decidir("/", resuelta(s));
    expect(d.accion).toBe("REESCRIBIR");
    expect(d.rutaInterna).toBe(RUTA_INTERNA_DE[s]);
    expect(d.estado).toBeNull();
    expect(d.superficie).toBe(s);
  });

  it("conserva la ruta debajo del prefijo", () => {
    expect(decidir("/panel/ventas", resuelta("APP")).rutaInterna).toBe("/s/app/panel/ventas");
    expect(decidir("/menu", resuelta("LANDING")).rutaInterna).toBe("/s/landing/menu");
    expect(decidir("/mesa/4", resuelta("CARTA")).rutaInterna).toBe("/s/carta/mesa/4");
    expect(decidir("/favicon.ico", resuelta("APP")).rutaInterna).toBe("/s/app/favicon.ico");
  });

  it("host desconocido: la neutra con 404", () => {
    const d = decidir("/panel", HOST_DESCONOCIDO);
    expect(d.accion).toBe("REESCRIBIR");
    expect(d.rutaInterna).toBe("/s/neutra");
    expect(d.estado).toBe(404);
    expect(d.superficie).toBe("NEUTRA");
  });

  it("la base caída: la neutra con 503 (no se confunde con desconocido ni cae en una marca)", () => {
    const d = decidir("/", HOST_NO_DISPONIBLE);
    expect(d.rutaInterna).toBe("/s/neutra");
    expect(d.estado).toBe(503);
    expect(d.superficie).toBe("NEUTRA");
  });

  it("la base caída con una URL interna o una API sigue siendo 503 neutra", () => {
    expect(decidir("/s/app", HOST_NO_DISPONIBLE).estado).toBe(503);
    expect(decidir("/api/auth/x", HOST_NO_DISPONIBLE).estado).toBe(503);
  });
});

describe("decidirPuerta: nadie entra por una URL interna", () => {
  it.each([
    "/s",
    "/s/",
    "/s/app",
    "/s/app/panel",
    "/s/neutra",
    "/s/landing",
    "/S/app",
    "/S",
    "/%73/app",
    "/%53/app",
    "/%73",
    "/s/%2e%2e/app",
  ])("%s en un host bueno es la neutra", (ruta) => {
    for (const s of SUPERFICIES_SERVIBLES) {
      const d = decidir(ruta, resuelta(s));
      expect(d.rutaInterna, `${s} ${ruta}`).toBe("/s/neutra");
      expect(d.estado).toBe(404);
      expect(d.superficie).toBe("NEUTRA");
    }
  });

  it.each(["/sitio", "/s.txt", "/sala/uno", "/panel/s/app", "/ss/app"])(
    "%s (empieza con s pero no es /s) sí se sirve",
    (ruta) => {
      expect(decidir(ruta, resuelta("LANDING")).rutaInterna).toBe(`/s/landing${ruta}`);
    },
  );
});

describe("decidirPuerta: rutas raras no se anteponen a un prefijo", () => {
  it.each([
    "panel",
    "",
    "//evil.com",
    "/a//b",
    "/a\\b",
    "/a/../b",
    "/a/./b",
    "/a/%2e%2e/b",
    "/a/%2E%2e/b",
    "/%2e/a",
    "/a/..",
    "/a/.",
    "/a%00b",
    "/a%0ab",
    "/a%1fb",
    "/a%7fb",
    "/a%zz",
    "/a%",
    "/\u0001",
  ])("%j es la neutra", (ruta) => {
    const d = decidir(ruta, resuelta("APP"));
    expect(d.rutaInterna).toBe("/s/neutra");
    expect(d.estado).toBe(404);
  });

  it.each(["/a.b", "/a..b", "/.well-known/x", "/..a", "/a/b.c", "/%41", "/ñ", "/a%20b", "/a%7e"])(
    "%j es una ruta normal",
    (ruta) => {
      expect(decidir(ruta, resuelta("APP")).rutaInterna).toBe(`/s/app${ruta}`);
    },
  );
});

describe("decidirPuerta: /api solo en un host APP", () => {
  it.each(["/api", "/api/auth/signin", "/api/auth/callback/google", "/api/salud"])(
    "%s en APP sigue su camino, con noindex",
    (ruta) => {
      const d = decidir(ruta, resuelta("APP"));
      expect(d.accion).toBe("SEGUIR");
      expect(d.rutaInterna).toBeNull();
      expect(d.estado).toBeNull();
      expect(d.superficie).toBe("APP");
      expect(d.encabezadosDeRespuesta["X-Robots-Tag"]).toBe("noindex");
    },
  );

  it.each(["LANDING", "CARTA"] as const)("/api/auth en %s es la neutra", (s) => {
    for (const ruta of ["/api", "/api/auth/signin", "/api/trabajos/cron"]) {
      const d = decidir(ruta, resuelta(s));
      expect(d.accion).toBe("REESCRIBIR");
      expect(d.rutaInterna).toBe("/s/neutra");
      expect(d.estado).toBe(404);
    }
  });

  it("/api en un host desconocido es la neutra", () => {
    expect(decidir("/api/auth/signin", HOST_DESCONOCIDO).rutaInterna).toBe("/s/neutra");
  });

  it.each(["/apix", "/API/auth", "/apis/x", "/%61pi/auth"])(
    "%s no es /api: se reescribe debajo del prefijo",
    (ruta) => {
      const d = decidir(ruta, resuelta("APP"));
      expect(d.accion).toBe("REESCRIBIR");
      expect(d.rutaInterna).toBe(`/s/app${ruta}`);
    },
  );
});

describe("decidirPuerta: encabezados del pedido que sigue", () => {
  it("borra todo x-zh-* del cliente y conserva el resto, en cualquier camino", () => {
    const entrantes = [
      ["host", "a.test"],
      ["x-zh-marca", "otra"],
      ["X-ZH-Superficie", "APP"],
      ["x-zh-nonce", "inventado"],
      ["accept", "text/html"],
      ["cookie", "a=1"],
    ] as [string, string][];
    for (const [ruta, resolucion] of [
      ["/", resuelta("LANDING")],
      ["/api/x", resuelta("APP")],
      ["/", HOST_DESCONOCIDO],
      ["/s/app", resuelta("APP")],
    ] as const) {
      const d = decidir(ruta, resolucion, entrantes);
      expect(d.encabezadosDePedido.get("x-zh-marca")).toBeNull();
      expect(d.encabezadosDePedido.get("x-zh-superficie")).toBeNull();
      expect(d.encabezadosDePedido.get("x-zh-nonce")).toBe(NONCE);
      expect(d.encabezadosDePedido.get("accept")).toBe("text/html");
      expect(d.encabezadosDePedido.get("cookie")).toBe("a=1");
      expect(d.encabezadosDePedido.get("host")).toBe("a.test");
    }
  });

  it("pone el nonce y la CSP de este pedido (Next marca sus scripts con ella)", () => {
    const d = decidir("/", resuelta("APP"), { "content-security-policy": "default-src *" });
    expect(d.encabezadosDePedido.get("x-zh-nonce")).toBe(NONCE);
    const csp = d.encabezadosDePedido.get("content-security-policy");
    expect(csp).toContain(`'nonce-${NONCE}'`);
    expect(csp).not.toContain("*");
    expect(csp).toBe(d.encabezadosDeRespuesta["Content-Security-Policy"]);
  });

  it("no modifica los encabezados que recibe", () => {
    const entrantes = new Headers([["x-zh-marca", "otra"]]);
    decidirPuerta({
      encabezados: entrantes,
      ruta: "/",
      resolucion: resuelta("APP"),
      produccion: true,
      nonce: NONCE,
    });
    expect(entrantes.get("x-zh-marca")).toBe("otra");
    expect(entrantes.has("x-zh-nonce")).toBe(false);
  });
});

describe("decidirPuerta: cabeceras de respuesta por superficie", () => {
  it.each([
    ["APP", true, true],
    ["APP", false, true],
    ["LANDING", true, false],
    ["LANDING", false, true],
    ["CARTA", true, true],
    ["CARTA", false, true],
  ] as const)("%s con produccion=%s: noindex=%s", (s, produccion, noindex) => {
    const d = decidir("/", resuelta(s), {}, produccion);
    expect(d.encabezadosDeRespuesta["X-Robots-Tag"] === "noindex").toBe(noindex);
  });

  it("la neutra es noindex aun en producción, y toda respuesta trae las cabeceras de seguridad", () => {
    for (const d of [
      decidir("/", HOST_DESCONOCIDO, {}, true),
      decidir("/", HOST_NO_DISPONIBLE, {}, true),
      decidir("/s/app", resuelta("LANDING"), {}, true),
    ]) {
      expect(d.encabezadosDeRespuesta["X-Robots-Tag"]).toBe("noindex");
      expect(d.encabezadosDeRespuesta["Content-Security-Policy"]).toContain(`'nonce-${NONCE}'`);
      expect(d.encabezadosDeRespuesta["Cache-Control"]).toBe("private, no-store");
    }
  });

  it("una ruta interna pedida a la landing en producción responde como neutra, no como landing", () => {
    expect(decidir("/s/x", resuelta("LANDING"), {}, true).superficie).toBe("NEUTRA");
  });
});
