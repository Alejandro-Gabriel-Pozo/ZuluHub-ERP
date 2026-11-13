import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { clasificacionDelProducto, type VinculoDeClasificacion } from "./clasificacion-de-producto";

const AHORA = new Date("2026-11-13T13:00:00Z");
const v = (id: string, nodoId: string | null, desde: string): VinculoDeClasificacion => ({
  id,
  nodoId,
  vigenteDesde: new Date(desde),
});

describe("clasificación vigente de un producto", () => {
  it("sin vínculos está «Sin elegir»", () => {
    expect(clasificacionDelProducto([], AHORA)).toEqual({ vigente: null, programados: [] });
  });

  it("rige el último con fecha hasta ahora, sin importar el orden en que llegan", () => {
    const a = v("a", "n1", "2026-01-01T00:00:00Z");
    const b = v("b", "n2", "2026-06-01T00:00:00Z");
    const c = v("c", "n3", "2026-03-01T00:00:00Z");
    expect(clasificacionDelProducto([a, b, c], AHORA).vigente).toBe(b);
    expect(clasificacionDelProducto([b, c, a], AHORA).vigente).toBe(b);
    expect(clasificacionDelProducto([c, a, b], AHORA).vigente).toBe(b);
  });

  it("un vínculo con fecha de este mismo instante ya rige", () => {
    const justo = v("j", "n1", "2026-11-13T13:00:00Z");
    expect(clasificacionDelProducto([justo], AHORA)).toEqual({ vigente: justo, programados: [] });
  });

  it("los de fecha futura no rigen todavía: quedan programados, del más próximo al más lejano, junto al vigente", () => {
    const hoy = v("h", "n1", "2026-11-01T00:00:00Z");
    const lejos = v("l", "n3", "2027-03-01T03:00:00Z");
    const cerca = v("c", "n2", "2026-11-14T03:00:00Z");
    const r = clasificacionDelProducto([lejos, hoy, cerca], AHORA);
    expect(r.vigente).toBe(hoy);
    expect(r.programados).toEqual([cerca, lejos]);
  });

  it("con la misma fecha (la base no lo permite, pero la función no depende de eso) rige el primero que llega, siempre el mismo", () => {
    const primero = v("p", "n1", "2026-05-01T00:00:00Z");
    const segundo = v("s", "n2", "2026-05-01T00:00:00Z");
    expect(clasificacionDelProducto([primero, segundo], AHORA).vigente).toBe(primero);
    expect(clasificacionDelProducto([segundo, primero], AHORA).vigente).toBe(segundo);
  });

  it("«Sin elegir» también es un vínculo: vuelve a dejar el producto sin clasificar", () => {
    const con = v("a", "n1", "2026-01-01T00:00:00Z");
    const sin = v("b", null, "2026-05-01T00:00:00Z");
    expect(clasificacionDelProducto([con, sin], AHORA).vigente).toBe(sin);
  });

  it("si solo hay programados, el producto sigue «Sin elegir» hasta que llegue la fecha", () => {
    const futuro = v("f", "n1", "2026-12-01T03:00:00Z");
    expect(clasificacionDelProducto([futuro], AHORA)).toEqual({
      vigente: null,
      programados: [futuro],
    });
  });

  it("propiedad: el vigente es el de fecha máxima hasta ahora y los programados son exactamente los posteriores, ordenados", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: -400, max: 400 }), { maxLength: 12 }),
        (dias) => {
          const vinculos = dias.map((d, i) =>
            v(
              `v${i}`,
              i % 3 === 0 ? null : `n${i}`,
              new Date(AHORA.getTime() + d * 86_400_000).toISOString(),
            ),
          );
          const r = clasificacionDelProducto(vinculos, AHORA);
          const pasados = vinculos.filter((x) => x.vigenteDesde.getTime() <= AHORA.getTime());
          const futuros = vinculos.filter((x) => x.vigenteDesde.getTime() > AHORA.getTime());
          const mayor =
            [...pasados].sort((a, b) => b.vigenteDesde.getTime() - a.vigenteDesde.getTime())[0] ??
            null;
          expect(r.vigente).toBe(mayor);
          expect(r.programados.map((x) => x.id)).toEqual(
            [...futuros]
              .sort((a, b) => a.vigenteDesde.getTime() - b.vigenteDesde.getTime())
              .map((x) => x.id),
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});
