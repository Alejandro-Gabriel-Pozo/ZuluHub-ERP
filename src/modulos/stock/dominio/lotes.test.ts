import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  elegirLotesParaSalida,
  ordenarFefo,
  sumaDeAsignaciones,
  type LoteCandidato,
} from "./lotes";

const lote = (loteId: string, over: Partial<LoteCandidato> = {}): LoteCandidato => ({
  loteId,
  esSinAsignar: false,
  primerIngreso: "2026-11-01",
  vence: null,
  calidad: null,
  existencia: 10n,
  ...over,
});
const sinAsignar = (existencia = 0n): LoteCandidato =>
  lote("sa", { esSinAsignar: true, existencia, primerIngreso: "2026-01-01" });
const HOY = "2026-11-10";

describe("orden FEFO", () => {
  it("vence antes primero, los que no vencen al final, el sin asignar último, desempata por ingreso y por id", () => {
    const orden = ordenarFefo([
      sinAsignar(),
      lote("d", { vence: null, primerIngreso: "2026-10-01" }),
      lote("c", { vence: "2026-12-01" }),
      lote("b", { vence: "2026-11-20", primerIngreso: "2026-11-05" }),
      lote("a", { vence: "2026-11-20", primerIngreso: "2026-11-02" }),
      lote("a2", { vence: "2026-11-20", primerIngreso: "2026-11-02" }),
    ]);
    expect(orden.map((l) => l.loteId)).toEqual(["a", "a2", "b", "c", "d", "sa"]);
  });
  it("entre dos que no vencen, el que entró antes primero, en cualquier orden de entrada", () => {
    const viejo = lote("viejo", { primerIngreso: "2026-10-01" });
    const nuevo = lote("nuevo", { primerIngreso: "2026-10-02" });
    expect(ordenarFefo([nuevo, viejo]).map((l) => l.loteId)).toEqual(["viejo", "nuevo"]);
    expect(ordenarFefo([viejo, nuevo]).map((l) => l.loteId)).toEqual(["viejo", "nuevo"]);
  });
  it("uno que vence va antes que uno que no, en cualquier orden de entrada", () => {
    const vence = lote("vence", { vence: "2027-01-01" });
    const nunca = lote("nunca");
    expect(ordenarFefo([nunca, vence]).map((l) => l.loteId)).toEqual(["vence", "nunca"]);
    expect(ordenarFefo([vence, nunca]).map((l) => l.loteId)).toEqual(["vence", "nunca"]);
  });
  it("no modifica la lista que recibe", () => {
    const entrada = [lote("b", { vence: "2026-12-01" }), lote("a", { vence: "2026-11-01" })];
    ordenarFefo(entrada);
    expect(entrada.map((l) => l.loteId)).toEqual(["b", "a"]);
  });
});

describe("elegir lotes para una salida", () => {
  it("toma del que vence antes y sigue con el siguiente", () => {
    const r = elegirLotesParaSalida(
      [
        lote("tarde", { vence: "2026-12-01" }),
        lote("pronto", { vence: "2026-11-12", existencia: 4n }),
        sinAsignar(),
      ],
      7n,
      "ENTREGA",
      HOY,
    );
    expect(r).toEqual([
      { loteId: "pronto", unidades: 4n },
      { loteId: "tarde", unidades: 3n },
    ]);
  });
  it("lo que no cubre ningún lote va al sin asignar (que puede quedar negativo)", () => {
    const r = elegirLotesParaSalida(
      [lote("a", { existencia: 2n }), sinAsignar()],
      5n,
      "ENTREGA",
      HOY,
    );
    expect(r).toEqual([
      { loteId: "a", unidades: 2n },
      { loteId: "sa", unidades: 3n },
    ]);
  });
  it("una entrega saltea lo vencido, en cuarentena, en revisión y rechazado", () => {
    const r = elegirLotesParaSalida(
      [
        lote("vencido", { vence: "2026-11-09" }),
        lote("cuarentena", { calidad: "EN_CUARENTENA" }),
        lote("revision", { calidad: "EN_REVISION" }),
        lote("rechazado", { calidad: "RECHAZADO" }),
        lote("vence-hoy", { vence: HOY, existencia: 1n }),
        sinAsignar(),
      ],
      3n,
      "ENTREGA",
      HOY,
    );
    expect(r).toEqual([
      { loteId: "vence-hoy", unidades: 1n },
      { loteId: "sa", unidades: 2n },
    ]);
  });
  it("un descarte puede tomar lo no disponible y respeta el lote nombrado", () => {
    const candidatos = [
      lote("vencido", { vence: "2026-11-09", existencia: 3n }),
      lote("bueno", { vence: "2026-12-01", existencia: 9n }),
      sinAsignar(),
    ];
    expect(elegirLotesParaSalida(candidatos, 2n, "DESCARTE", HOY)).toEqual([
      { loteId: "vencido", unidades: 2n },
    ]);
    expect(elegirLotesParaSalida(candidatos, 2n, "DESCARTE", HOY, "bueno")).toEqual([
      { loteId: "bueno", unidades: 2n },
    ]);
    expect(elegirLotesParaSalida(candidatos, 5n, "DESCARTE", HOY, "bueno")).toEqual([
      { loteId: "bueno", unidades: 5n },
    ]);
    expect(elegirLotesParaSalida(candidatos, 11n, "DESCARTE", HOY, "bueno")).toEqual([
      { loteId: "bueno", unidades: 9n },
      { loteId: "vencido", unidades: 2n },
    ]);
  });
  it("un lote nombrado que no existe se ignora; un lote sin existencia no se toca", () => {
    const r = elegirLotesParaSalida(
      [lote("vacio", { existencia: 0n }), lote("a", { existencia: 1n }), sinAsignar()],
      1n,
      "ENTREGA",
      HOY,
      "no-esta",
    );
    expect(r).toEqual([{ loteId: "a", unidades: 1n }]);
    const n = elegirLotesParaSalida(
      [lote("neg", { existencia: -2n }), sinAsignar()],
      1n,
      "ENTREGA",
      HOY,
    );
    expect(n).toEqual([{ loteId: "sa", unidades: 1n }]);
  });
  it("el lote nombrado que sale primero no se repite aunque sobre cantidad por repartir", () => {
    const candidatos = [
      lote("elegido", { vence: "2026-11-11", existencia: 3n }),
      lote("otro", { vence: "2026-12-01", existencia: 10n }),
      sinAsignar(),
    ];
    expect(elegirLotesParaSalida(candidatos, 8n, "DESCARTE", HOY, "otro")).toEqual([
      { loteId: "otro", unidades: 8n },
    ]);
    expect(elegirLotesParaSalida(candidatos, 12n, "DESCARTE", HOY, "otro")).toEqual([
      { loteId: "otro", unidades: 10n },
      { loteId: "elegido", unidades: 2n },
    ]);
    expect(elegirLotesParaSalida(candidatos, 14n, "DESCARTE", HOY, "otro")).toEqual([
      { loteId: "otro", unidades: 10n },
      { loteId: "elegido", unidades: 3n },
      { loteId: "sa", unidades: 1n },
    ]);
  });
  it("una cantidad que no es positiva o un artículo sin sin-asignar es un defecto", () => {
    expect(() => elegirLotesParaSalida([sinAsignar()], 0n, "ENTREGA", HOY)).toThrow(
      "mayor que cero",
    );
    expect(() =>
      elegirLotesParaSalida([lote("a", { existencia: 1n })], 5n, "ENTREGA", HOY),
    ).toThrow("sin asignar");
  });
  it("una existencia justo igual a lo pedido se toma entera", () => {
    expect(
      elegirLotesParaSalida([lote("a", { existencia: 4n }), sinAsignar()], 4n, "ENTREGA", HOY),
    ).toEqual([{ loteId: "a", unidades: 4n }]);
  });
  it("propiedad: siempre reparte exactamente lo pedido y ningún lote real baja de cero", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            existencia: fc.bigInt({ min: 0n, max: 50n }),
            dia: fc.integer({ min: 1, max: 28 }),
            mala: fc.boolean(),
          }),
          { maxLength: 6 },
        ),
        fc.bigInt({ min: 1n, max: 200n }),
        (lotes, pedido) => {
          const candidatos = [
            ...lotes.map((l, i) =>
              lote(`l${i}`, {
                existencia: l.existencia,
                vence: `2026-12-${String(l.dia).padStart(2, "0")}`,
                calidad: l.mala ? "RECHAZADO" : null,
              }),
            ),
            sinAsignar(),
          ];
          for (const modo of ["ENTREGA", "DESCARTE"] as const) {
            const r = elegirLotesParaSalida(candidatos, pedido, modo, HOY);
            expect(sumaDeAsignaciones(r)).toBe(pedido);
            for (const a of r) {
              const origen = candidatos.find((l) => l.loteId === a.loteId)!;
              expect(a.unidades > 0n).toBe(true);
              if (!origen.esSinAsignar) expect(a.unidades <= origen.existencia).toBe(true);
              if (modo === "ENTREGA" && !origen.esSinAsignar) expect(origen.calidad).toBeNull();
            }
          }
        },
      ),
    );
  });
});
