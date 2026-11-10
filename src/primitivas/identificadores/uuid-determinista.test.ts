import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { uuidV5, uuidV5DeLista } from "./uuid-determinista";

const DNS = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const ESPACIO = "0b3a0c5e-8f7d-4c1b-9a2e-1d2c3b4a5f60";
const FORMA = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("uuidV5", () => {
  it("coincide con los vectores conocidos de RFC 4122 (uuid v5 del espacio DNS)", () => {
    expect(uuidV5(DNS, "python.org")).toBe("886313e1-3b8a-5372-9b90-0c9aee199e5d");
    expect(uuidV5(DNS, "www.example.com")).toBe("2ed6657d-e927-568b-95e1-2665a8aea6a2");
  });

  it("es determinístico: mismo espacio y nombre, mismo uuid; otro nombre u otro espacio, otro uuid", () => {
    expect(uuidV5(ESPACIO, "a")).toBe(uuidV5(ESPACIO, "a"));
    expect(uuidV5(ESPACIO, "a")).not.toBe(uuidV5(ESPACIO, "b"));
    expect(uuidV5(ESPACIO, "a")).not.toBe(uuidV5(DNS, "a"));
  });

  it("siempre tiene la forma de un uuid versión 5 con variante RFC 4122", () => {
    fc.assert(fc.property(fc.string(), (nombre) => FORMA.test(uuidV5(ESPACIO, nombre))));
  });

  it("el nombre se codifica en UTF-8", () => {
    expect(uuidV5(DNS, "ñandú")).not.toBe(uuidV5(DNS, "nandu"));
    expect(uuidV5(DNS, "ñandú")).toBe(uuidV5(DNS, "ñandú"));
  });

  it.each(["", "no-es-uuid", ESPACIO.toUpperCase(), `${ESPACIO} `, ESPACIO.replaceAll("-", "")])(
    "rechaza un espacio de nombres que no es un uuid en minúscula: %j",
    (espacio) => {
      expect(() => uuidV5(espacio, "x")).toThrow(RangeError);
      expect(() => uuidV5(espacio, "x")).toThrow("uuid en minúscula");
    },
  );

  it("un espacio con algo antes del uuid también se rechaza (la forma está anclada al principio)", () => {
    expect(() => uuidV5(`x${ESPACIO}`, "x")).toThrow(RangeError);
    expect(() => uuidV5(`${ESPACIO}x`, "x")).toThrow(RangeError);
  });
});

describe("uuidV5DeLista (el origen de cada intento: mismo ticket e intento = mismo origen)", () => {
  it("mismas partes, mismo uuid; distinto intento o distinto ticket, distinto uuid", () => {
    expect(uuidV5DeLista(ESPACIO, ["ticket-1", "1"])).toBe(
      uuidV5DeLista(ESPACIO, ["ticket-1", "1"]),
    );
    expect(uuidV5DeLista(ESPACIO, ["ticket-1", "1"])).not.toBe(
      uuidV5DeLista(ESPACIO, ["ticket-1", "2"]),
    );
    expect(uuidV5DeLista(ESPACIO, ["ticket-1", "1"])).not.toBe(
      uuidV5DeLista(ESPACIO, ["ticket-2", "1"]),
    );
  });

  it("las partes no se confunden al pegarse: [a, bc] ≠ [ab, c] y [a, b] ≠ [a,b]", () => {
    expect(uuidV5DeLista(ESPACIO, ["a", "bc"])).not.toBe(uuidV5DeLista(ESPACIO, ["ab", "c"]));
    expect(uuidV5DeLista(ESPACIO, ["a", "b"])).not.toBe(uuidV5DeLista(ESPACIO, ["a,b"]));
    expect(uuidV5DeLista(ESPACIO, [])).not.toBe(uuidV5DeLista(ESPACIO, [""]));
  });

  it("dos listas distintas nunca dan el mismo uuid (propiedad)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string(), { maxLength: 4 }),
        fc.array(fc.string(), { maxLength: 4 }),
        (a, b) => {
          fc.pre(JSON.stringify(a) !== JSON.stringify(b));
          expect(uuidV5DeLista(ESPACIO, a)).not.toBe(uuidV5DeLista(ESPACIO, b));
        },
      ),
    );
  });
});
