import { describe, expect, it } from "vitest";
import {
  BYTES_DE_UN_NONCE,
  cabecerasDe,
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
    expect(directivas.get("img-src")).toBe("'self'");
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
  it("solo la landing y solo en producción", () => {
    for (const s of SUPERFICIES) {
      for (const produccion of [true, false]) {
        expect(esIndexable(s, produccion), `${s} ${String(produccion)}`).toBe(
          s === "LANDING" && produccion,
        );
      }
    }
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
