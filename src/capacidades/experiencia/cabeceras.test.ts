import { describe, expect, it } from "vitest";
import {
  BYTES_DE_UN_NONCE,
  cabecerasDe,
  CARTA_INDEXABLE_SEGUN_DUENIO,
  esIndexable,
  esNonceValido,
  nonceDe,
  politicaDeContenido,
  type SuperficieDeRespuesta,
} from "./cabeceras";

const NONCE = nonceDe(new Uint8Array(16).fill(1));
const SUPERFICIES: readonly SuperficieDeRespuesta[] = [
  "APP",
  "LANDING",
  "CARTA",
  "NEUTRA",
  "SISTEMA",
];

describe("nonceDe", () => {
  it("es el base64 de los bytes", () => {
    expect(nonceDe(new Uint8Array(16).fill(0))).toBe("AAAAAAAAAAAAAAAAAAAAAA==");
    expect(nonceDe(new Uint8Array(16).fill(255))).toBe("/////////////////////w==");
    expect(nonceDe(Uint8Array.from({ length: 16 }, (_, i) => i))).toBe("AAECAwQFBgcICQoLDA0ODw==");
  });

  it("exige al menos 16 bytes", () => {
    expect(BYTES_DE_UN_NONCE).toBe(16);
    expect(() => nonceDe(new Uint8Array(15))).toThrow(RangeError);
    expect(() => nonceDe(new Uint8Array(0))).toThrow(/16 bytes/);
    expect(nonceDe(new Uint8Array(16))).toHaveLength(24);
    expect(nonceDe(new Uint8Array(24))).toHaveLength(32);
  });

  it("lo que fabrica siempre es válido", () => {
    for (let n = 16; n < 40; n += 1) {
      expect(esNonceValido(nonceDe(new Uint8Array(n).fill(n)))).toBe(true);
    }
  });
});

describe("esNonceValido", () => {
  it.each([
    ["AAAAAAAAAAAAAAAAAAAAAA==", true],
    ["AAAAAAAAAAAAAAAAAAAAAA", true],
    ["abcDEF012345+/abcDEF01==", true],
    ["a".repeat(22), true],
    ["a".repeat(21), false],
    ["", false],
    ["AAAAAAAAAAAAAAAAAAAAAA===", false],
    ["AAAAAAAAAAAAAAAAAAAAAA;", false],
    ["AAAAAAAAAAAAAAAAAAAAAA'", false],
    ["AAAAAAAAAAAAAAAAAAAAAA ", false],
    [" AAAAAAAAAAAAAAAAAAAAAA", false],
    ["AAAAAAAAAAAAAAAAAAAAAA\n", false],
    ["AAAAAAAAAAAAAAAAAAAAAA-_", false],
    ["AAAAA=AAAAAAAAAAAAAAAAAA", false],
    ["AAAAAAAAAAAAAAAAAAAAAA==x", false],
    ["ÁAAAAAAAAAAAAAAAAAAAAA", false],
  ])("%j → %s", (nonce, esperado) => {
    expect(esNonceValido(nonce)).toBe(esperado);
  });
});

describe("politicaDeContenido", () => {
  const politica = politicaDeContenido(NONCE);
  const directivas = new Map(
    politica.split("; ").map((d) => [d.slice(0, d.indexOf(" ")), d.slice(d.indexOf(" ") + 1)]),
  );

  it("scripts propios con nonce y strict-dynamic, nada más", () => {
    expect(directivas.get("script-src")).toBe(`'self' 'nonce-${NONCE}' 'strict-dynamic'`);
    expect(politica).not.toContain("unsafe-inline");
    expect(politica).not.toContain("unsafe-eval");
  });

  it("estilos propios o con nonce", () => {
    expect(directivas.get("style-src")).toBe(`'self' 'nonce-${NONCE}'`);
  });

  it("no se puede enmarcar ni usar objetos ni <base>", () => {
    expect(directivas.get("frame-ancestors")).toBe("'none'");
    expect(directivas.get("object-src")).toBe("'none'");
    expect(directivas.get("base-uri")).toBe("'none'");
  });

  it("todo lo demás solo de la propia casa", () => {
    expect(directivas.get("default-src")).toBe("'self'");
    expect(directivas.get("img-src")).toBe("'self' data:");
    expect(directivas.get("font-src")).toBe("'self'");
    expect(directivas.get("connect-src")).toBe("'self'");
    expect(directivas.get("form-action")).toBe("'self'");
    expect([...directivas.keys()]).toHaveLength(10);
  });

  it("un nonce distinto da una política distinta", () => {
    const otro = nonceDe(new Uint8Array(16).fill(2));
    expect(politicaDeContenido(otro)).toContain(`'nonce-${otro}'`);
    expect(politicaDeContenido(otro)).not.toContain(NONCE);
  });

  it.each(["", "x", "a;b", "AAAAAAAAAAAAAAAAAAAAAA'; script-src *", "AAAAAAAAAAAAAAAAAAAAAA\n"])(
    "rechaza el nonce %j antes de ponerlo en una cabecera",
    (nonce) => {
      expect(() => politicaDeContenido(nonce)).toThrow(RangeError);
      expect(() => politicaDeContenido(nonce)).toThrow(/nonce inválido/);
      expect(() => cabecerasDe("APP", nonce, { produccion: true })).toThrow(RangeError);
    },
  );
});

describe("esIndexable", () => {
  const DUENIOS = ["MARCA", "EMPRESA", null] as const;

  it("la landing solo en producción; la app, la neutra y el sistema nunca", () => {
    for (const s of SUPERFICIES.filter((x) => x !== "CARTA")) {
      for (const produccion of [true, false]) {
        for (const duenio of DUENIOS) {
          expect(
            esIndexable(s, produccion, duenio),
            `${s} ${String(produccion)} ${String(duenio)}`,
          ).toBe(s === "LANDING" && produccion);
        }
      }
    }
  });

  it("la carta del host COMPARTIDO (dueño MARCA) nunca se indexa, en producción o no (dueño, 16/11/2026)", () => {
    expect(esIndexable("CARTA", true, "MARCA")).toBe(false);
    expect(esIndexable("CARTA", false, "MARCA")).toBe(false);
  });

  it("la carta de un dominio propio (dueño EMPRESA) nace cerrada: hoy tampoco se indexa", () => {
    // Cuando el dueño lo decida, se abre en `CARTA_INDEXABLE_SEGUN_DUENIO` y esta prueba cambia a `true` solo para producción.
    expect(esIndexable("CARTA", true, "EMPRESA")).toBe(false);
    expect(esIndexable("CARTA", false, "EMPRESA")).toBe(false);
  });

  it("la carta sin dueño conocido se cierra", () => {
    expect(esIndexable("CARTA", true, null)).toBe(false);
  });
});

describe("esIndexable: la regla con la tabla abierta (hoy cerrada en producción)", () => {
  const ABIERTA = { MARCA: true, EMPRESA: true } as const;
  const SOLO_EMPRESA = { MARCA: false, EMPRESA: true } as const;

  it("la tabla de producción es exactamente esta: ambos dueños cerrados, y no se puede cambiar en caliente", () => {
    expect(CARTA_INDEXABLE_SEGUN_DUENIO).toEqual({ MARCA: false, EMPRESA: false });
    expect(Object.isFrozen(CARTA_INDEXABLE_SEGUN_DUENIO)).toBe(true);
  });

  it("con la tabla abierta, la carta con dueño conocido se indexa en producción, y solo ahí", () => {
    for (const duenio of ["MARCA", "EMPRESA"] as const) {
      expect(esIndexable("CARTA", true, duenio, ABIERTA)).toBe(true);
      expect(esIndexable("CARTA", false, duenio, ABIERTA)).toBe(false);
    }
  });

  it("con la tabla abierta, sin dueño conocido sigue cerrada, y la app, la neutra y el sistema no se abren por eso", () => {
    expect(esIndexable("CARTA", true, null, ABIERTA)).toBe(false);
    for (const s of ["APP", "NEUTRA", "SISTEMA"] as const) {
      for (const duenio of ["MARCA", "EMPRESA", null] as const) {
        expect(esIndexable(s, true, duenio, ABIERTA), `${s} ${String(duenio)}`).toBe(false);
      }
    }
  });

  it("sin dueño conocido no se consulta la tabla: ni una tabla con una entrada «null» abre la carta", () => {
    const rara = { MARCA: true, EMPRESA: true, null: true } as unknown as typeof ABIERTA;
    expect(esIndexable("CARTA", true, null, rara)).toBe(false);
  });

  it("la tabla se consulta por el dueño: abierta solo para la empresa, la marca sigue cerrada", () => {
    expect(esIndexable("CARTA", true, "EMPRESA", SOLO_EMPRESA)).toBe(true);
    expect(esIndexable("CARTA", true, "MARCA", SOLO_EMPRESA)).toBe(false);
  });

  it("`cabecerasDe` pasa el dueño y la tabla: carta indexable sin `X-Robots-Tag`; sin dueño, con `noindex`", () => {
    const con = cabecerasDe("CARTA", NONCE, {
      produccion: true,
      duenio: "EMPRESA",
      tabla: SOLO_EMPRESA,
    });
    expect(con["X-Robots-Tag"]).toBeUndefined();
    const sinDuenio = cabecerasDe("CARTA", NONCE, { produccion: true, tabla: SOLO_EMPRESA });
    expect(sinDuenio["X-Robots-Tag"]).toBe("noindex");
    const marca = cabecerasDe("CARTA", NONCE, {
      produccion: true,
      duenio: "MARCA",
      tabla: SOLO_EMPRESA,
    });
    expect(marca["X-Robots-Tag"]).toBe("noindex");
  });
});

describe("cabecerasDe", () => {
  it.each(SUPERFICIES)("%s: las cabeceras de seguridad, con sus valores exactos", (s) => {
    const c = cabecerasDe(s, NONCE, { produccion: true });
    expect(c["Content-Security-Policy"]).toBe(politicaDeContenido(NONCE));
    expect(c["Strict-Transport-Security"]).toBe("max-age=31536000");
    // Los hosts son dominios de clientes: sus subdominios no son nuestros.
    expect(c["Strict-Transport-Security"]).not.toMatch(/includeSubDomains|preload/i);
    expect(c["X-Content-Type-Options"]).toBe("nosniff");
    expect(c["Referrer-Policy"]).toBe("same-origin");
    expect(c["Permissions-Policy"]).toBe("camera=(), microphone=(), geolocation=()");
    expect(c["Cache-Control"]).toBe("private, no-store");
  });

  it("la excepción del logo solo quita Cache-Control (el resto de las cabeceras de seguridad siguen) y solo con `cacheDelLogo` en verdadero", () => {
    for (const s of SUPERFICIES) {
      const con = cabecerasDe(s, NONCE, { produccion: true, cacheDelLogo: true });
      expect("Cache-Control" in con).toBe(false);
      const resto: Record<string, string> = { ...cabecerasDe(s, NONCE, { produccion: true }) };
      delete resto["Cache-Control"];
      expect(con).toEqual(resto);
      expect(
        cabecerasDe(s, NONCE, { produccion: true, cacheDelLogo: false })["Cache-Control"],
      ).toBe("private, no-store");
    }
  });

  it("nunca manda X-Powered-By ni cookies", () => {
    for (const s of SUPERFICIES) {
      const nombres = Object.keys(cabecerasDe(s, NONCE, { produccion: true })).map((n) =>
        n.toLowerCase(),
      );
      expect(nombres).not.toContain("x-powered-by");
      expect(nombres).not.toContain("set-cookie");
    }
  });

  it("X-Robots-Tag: noindex salvo la landing en producción", () => {
    for (const s of SUPERFICIES) {
      for (const produccion of [true, false]) {
        const c = cabecerasDe(s, NONCE, { produccion });
        if (s === "LANDING" && produccion) {
          expect(Object.keys(c)).not.toContain("X-Robots-Tag");
          expect(Object.keys(c)).toHaveLength(6);
        } else {
          expect(c["X-Robots-Tag"]).toBe("noindex");
          expect(Object.keys(c)).toHaveLength(7);
        }
      }
    }
  });

  it("está congelado", () => {
    expect(Object.isFrozen(cabecerasDe("APP", NONCE, { produccion: false }))).toBe(true);
  });
});
