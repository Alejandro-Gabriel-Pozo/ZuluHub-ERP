import { createHash } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../../test/propiedades/configuracion";
import {
  LARGO_MAXIMO_DEL_SLUG,
  direccionDeProducto,
  direccionesDeCarta,
  huellaDeProducto,
  resolverProductoPorSegmento,
  slugDeNombre,
} from "./direccion";

/** C-12: propiedades de `direccionDeProducto` (§3.3), con nombres de cualquier tipo, también los hostiles. */

const nombre = fc.oneof(
  fc.string({ maxLength: 120 }),
  fc.string({ unit: "grapheme", maxLength: 80 }),
);
const uuid = fc.uuid({ version: 4 });
const productos = fc
  .uniqueArray(uuid, { minLength: 1, maxLength: 12 })
  .chain((ids) =>
    fc
      .array(nombre, { minLength: ids.length, maxLength: ids.length })
      .map((nombres) => ids.map((productoId, i) => ({ productoId, nombre: nombres[i] as string }))),
  );

describe("slugDeNombre: propiedades", () => {
  it("solo tiene [a-z0-9-], no es vacío, no pasa de 60 y no empieza ni termina en guion ni repite guiones", () => {
    fc.assert(
      fc.property(nombre, (n) => {
        const s = slugDeNombre(n);
        expect(s).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
        expect(s.length).toBeLessThanOrEqual(LARGO_MAXIMO_DEL_SLUG);
      }),
    );
  });

  it("es idempotente", () => {
    fc.assert(
      fc.property(nombre, (n) => {
        expect(slugDeNombre(slugDeNombre(n))).toBe(slugDeNombre(n));
      }),
    );
  });

  it("no tiene caracteres peligrosos para una URL, un atributo HTML o un encabezado", () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 60 }).map((s) => `${s}<>"'&%/\\?#.. \n\r\u0000`),
        (n) => {
          expect(slugDeNombre(n)).not.toMatch(/[^a-z0-9-]/);
        },
      ),
    );
  });
});

describe("direccionDeProducto: propiedades", () => {
  it("el sufijo son 8 hexadecimales, la dirección nunca es vacía y es determinista", () => {
    fc.assert(
      fc.property(uuid, uuid, nombre, (cartaId, productoId, n) => {
        const d = direccionDeProducto(cartaId, { productoId, nombre: n });
        expect(d.h8).toMatch(/^[0-9a-f]{8}$/);
        expect(d.segmento).toMatch(/^[a-z0-9-]+-[0-9a-f]{8}$/);
        expect(d.segmento).toBe(`${d.slug}-${d.h8}`);
        expect(direccionDeProducto(cartaId, { productoId, nombre: n })).toEqual(d);
      }),
    );
  });

  it("coincide con un SHA-256 calculado aparte", () => {
    fc.assert(
      fc.property(uuid, uuid, (cartaId, productoId) => {
        const esperado = createHash("sha256")
          .update(`producto-de-carta:${cartaId}${productoId}`)
          .digest("hex");
        expect(huellaDeProducto(cartaId, productoId)).toBe(esperado.slice(0, 8));
        expect(huellaDeProducto(cartaId, productoId, 12)).toBe(esperado.slice(0, 12));
      }),
    );
  });

  it("no expone ningún id interno: ni el de la carta ni el del producto", () => {
    fc.assert(
      fc.property(
        uuid,
        uuid,
        nombre.filter((n) => !/[0-9a-f]{8}-[0-9a-f]{4}/i.test(n)),
        (cartaId, productoId, n) => {
          const { segmento } = direccionDeProducto(cartaId, { productoId, nombre: n });
          expect(segmento).not.toContain(cartaId);
          expect(segmento).not.toContain(productoId);
          expect(segmento).not.toContain(cartaId.replaceAll("-", ""));
          expect(segmento).not.toContain(productoId.replaceAll("-", ""));
        },
      ),
    );
  });

  it("estable ante un renombre: el sufijo no cambia con el nombre", () => {
    fc.assert(
      fc.property(uuid, uuid, nombre, nombre, (cartaId, productoId, a, b) => {
        expect(direccionDeProducto(cartaId, { productoId, nombre: a }).h8).toBe(
          direccionDeProducto(cartaId, { productoId, nombre: b }).h8,
        );
      }),
    );
  });
});

describe("direccionesDeCarta y resolución: propiedades", () => {
  it("dos productos distintos de una carta nunca comparten dirección, aunque se llamen igual", () => {
    fc.assert(
      fc.property(uuid, productos, (cartaId, ps) => {
        const iguales = ps.map((p) => ({ ...p, nombre: "Café" }));
        const segmentos = direccionesDeCarta(cartaId, iguales).map((d) => d.segmento);
        expect(new Set(segmentos).size).toBe(segmentos.length);
      }),
    );
  });

  it("round-trip: resolver la dirección de un producto devuelve ese producto, sin redirigir", () => {
    fc.assert(
      fc.property(uuid, productos, (cartaId, ps) => {
        const direcciones = direccionesDeCarta(cartaId, ps);
        for (const [i, p] of ps.entries()) {
          const r = resolverProductoPorSegmento(
            cartaId,
            ps,
            (direcciones[i] as { segmento: string }).segmento,
          );
          expect(r.ok && r.valor.productoId).toBe(p.productoId);
          expect(r.ok && r.valor.redirigir).toBe(false);
        }
      }),
    );
  });

  it("tras un renombre, el enlace viejo sigue resolviendo y redirige si y solo si cambió el slug", () => {
    fc.assert(
      fc.property(uuid, productos, nombre, (cartaId, ps, nuevo) => {
        const antes = direccionesDeCarta(cartaId, ps)[0] as { segmento: string };
        const renombrados = ps.map((p, i) => (i === 0 ? { ...p, nombre: nuevo } : p));
        const r = resolverProductoPorSegmento(cartaId, renombrados, antes.segmento);
        expect(r.ok && r.valor.productoId).toBe((ps[0] as { productoId: string }).productoId);
        const cambioElSlug =
          slugDeNombre((ps[0] as { nombre: string }).nombre) !== slugDeNombre(nuevo);
        expect(r.ok && r.valor.redirigir).toBe(cambioElSlug);
      }),
    );
  });

  it("un sufijo ajeno a la carta no resuelve nada", () => {
    fc.assert(
      fc.property(uuid, uuid, productos, (cartaId, otraCarta, ps) => {
        fc.pre(cartaId !== otraCarta);
        const ajena = direccionesDeCarta(otraCarta, ps)[0] as { h8: string };
        const propios = direccionesDeCarta(cartaId, ps).map((d) => d.h8);
        fc.pre(!propios.includes(ajena.h8));
        const r = resolverProductoPorSegmento(cartaId, ps, `x-${ajena.h8}`);
        expect(r).toEqual({ ok: false, error: "PRODUCTO_NO_ENCONTRADO" });
      }),
    );
  });

  it("resolver nunca lanza, con cualquier texto", () => {
    fc.assert(
      fc.property(uuid, productos, fc.string({ maxLength: 80 }), (cartaId, ps, texto) => {
        expect(() => resolverProductoPorSegmento(cartaId, ps, texto)).not.toThrow();
      }),
    );
  });
});
