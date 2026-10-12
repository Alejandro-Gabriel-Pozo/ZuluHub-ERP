import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../../test/propiedades/configuracion";
import { normalizarHost } from "./host";

/**
 * Propiedades de `normalizarHost` (marcas y planes, §B.2.2 y §D «Normalización»). El oráculo es OTRA
 * forma de escribir la misma regla —una sola expresión que parte el texto en host y puerto, en vez de
 * quitar partes de a una—, para que un error de interpretación no pase inadvertido. La misma regla se
 * compara contra `host_valido()` de la base en el tramo de SQL.
 */

function oraculo(entrada: string): string | null {
  const partes = /^((?:[A-Za-z0-9-]+\.)*[A-Za-z0-9-]+)\.?(?::([0-9]{1,5}))?$/.exec(entrada);
  if (partes === null) return null;
  const host = (partes[1] as string).toLowerCase();
  if (partes[2] !== undefined && Number(partes[2]) > 65_535) return null;
  if (host.length > 253) return null;
  const etiquetas = host.split(".");
  const bienFormadas = etiquetas.every(
    (e) => e.length <= 63 && /^[a-z0-9]/.test(e) && /[a-z0-9]$/.test(e),
  );
  const ultima = etiquetas[etiquetas.length - 1] as string;
  const esNumero = /^[0-9]+$/.test(ultima) || /^0x[0-9a-f]*$/.test(ultima);
  return bienFormadas && !esNumero ? host : null;
}

// Un alfabeto chico y rico en lo peligroso: así los casos válidos y los casi válidos son frecuentes.
const caracter = fc.constantFrom(..."abcxyzABCXYZ019-.:x_ []/Kİé。\n".split(""));
const textoCualquiera = fc.oneof(
  fc.string({ unit: caracter, maxLength: 24 }),
  fc.string({ maxLength: 40 }),
  fc.string({ unit: "binary", maxLength: 20 }),
);

const etiqueta = fc.stringMatching(/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,10}[a-zA-Z0-9])?$/);
const hostBienFormado = fc
  .tuple(
    fc.array(etiqueta, { minLength: 1, maxLength: 5 }),
    fc.constantFrom("a", "com", "ar", "xn--p1ai", "9x", "Z"),
  )
  .map(([etiquetas, tld]) => [...etiquetas, tld].join("."));
const decorado = fc
  .tuple(
    hostBienFormado,
    fc.boolean(),
    fc.option(fc.integer({ min: 0, max: 65_535 }), { nil: undefined }),
  )
  .map(
    ([host, punto, puerto]) =>
      `${host}${punto ? "." : ""}${puerto === undefined ? "" : `:${puerto}`}`,
  );

describe("normalizarHost: propiedades", () => {
  it("coincide con el oráculo en miles de textos, válidos o no", () => {
    fc.assert(
      fc.property(fc.oneof(textoCualquiera, decorado), (entrada) => {
        const esperado = oraculo(entrada);
        const real = normalizarHost(entrada);
        expect(real.ok ? real.valor : null).toBe(esperado);
      }),
      { numRuns: 3000 },
    );
  });

  it("nunca lanza, sea cual sea el texto", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 300 }), (entrada) => {
        expect(() => normalizarHost(entrada)).not.toThrow();
      }),
    );
  });

  it("es idempotente: lo normalizado se normaliza a sí mismo", () => {
    fc.assert(
      fc.property(fc.oneof(textoCualquiera, decorado), (entrada) => {
        const una = normalizarHost(entrada);
        if (!una.ok) return;
        expect(normalizarHost(una.valor)).toEqual(una);
      }),
    );
  });

  it("lo que devuelve es ASCII en minúsculas, sin puerto, sin punto final y de largo acotado", () => {
    fc.assert(
      fc.property(decorado, (entrada) => {
        const r = normalizarHost(entrada);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.valor).toMatch(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/);
        expect(r.valor.length).toBeLessThanOrEqual(253);
        expect(r.valor.endsWith(".")).toBe(false);
        expect(r.valor.includes(":")).toBe(false);
      }),
    );
  });

  it("no distingue mayúsculas, puerto ni punto final: todas las formas dan el mismo host", () => {
    fc.assert(
      fc.property(hostBienFormado, fc.integer({ min: 0, max: 65_535 }), (host, puerto) => {
        const base = normalizarHost(host.toLowerCase());
        expect(base.ok).toBe(true);
        for (const variante of [
          host,
          host.toUpperCase(),
          `${host}.`,
          `${host}:${puerto}`,
          `${host.toUpperCase()}.:${puerto}`,
        ]) {
          expect(normalizarHost(variante)).toEqual(base);
        }
      }),
    );
  });

  it("agregar o quitar etiquetas cambia el host: no hay coincidencia por sufijo ni por prefijo", () => {
    fc.assert(
      fc.property(hostBienFormado, etiqueta, (host, extra) => {
        const base = normalizarHost(host);
        const conPrefijo = normalizarHost(`${extra}.${host}`);
        const conSufijo = normalizarHost(`${host}.${extra}z`);
        expect(base.ok && conPrefijo.ok && conSufijo.ok).toBe(true);
        if (!(base.ok && conPrefijo.ok && conSufijo.ok)) return;
        expect(conPrefijo.valor).not.toBe(base.valor);
        expect(conSufijo.valor).not.toBe(base.valor);
      }),
    );
  });

  it("cualquier IPv4 en decimal, con o sin puerto, se rechaza", () => {
    fc.assert(
      fc.property(
        fc.tuple(...[0, 1, 2, 3].map(() => fc.integer({ min: 0, max: 999 }))),
        fc.option(fc.integer({ min: 0, max: 65_535 }), { nil: undefined }),
        (partes, puerto) => {
          const ip = partes.join(".");
          expect(normalizarHost(ip).ok).toBe(false);
          if (puerto !== undefined) expect(normalizarHost(`${ip}:${puerto}`).ok).toBe(false);
        },
      ),
    );
  });

  it("un texto con algún carácter fuera de ASCII nunca es un host", () => {
    fc.assert(
      fc.property(
        hostBienFormado,
        fc
          .string({ unit: "grapheme", minLength: 1, maxLength: 3 })
          .filter((t) => /\P{ASCII}/u.test(t)),
        fc.nat(),
        (host, raro, posicion) => {
          const donde = posicion % (host.length + 1);
          expect(normalizarHost(host.slice(0, donde) + raro + host.slice(donde)).ok).toBe(false);
        },
      ),
    );
  });
});
