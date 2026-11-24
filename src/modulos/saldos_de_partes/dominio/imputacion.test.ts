import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../../test/propiedades/configuracion";
import {
  importeATexto,
  importeDesdeTexto,
  sumar,
  importeCero,
  type Importe,
} from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import { fechaCivilDesdeTexto, type FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import { repartirLoMasAntiguo, type CargoAbierto } from "./imputacion";

const imp = (t: string): Importe => importeDesdeTexto(ARS, t);
const fecha = (t: string): FechaCivil => {
  const r = fechaCivilDesdeTexto(t);
  if (!r.ok) throw new Error(t);
  return r.valor;
};
const cargo = (
  id: string,
  venceEl: string | null,
  registrado: string,
  pendiente: string,
): CargoAbierto => ({
  id,
  venceEl: venceEl === null ? null : fecha(venceEl),
  registradoEn: new Date(registrado),
  pendiente: imp(pendiente),
});
const dicho = (r: ReturnType<typeof repartirLoMasAntiguo>) =>
  r.ok ? r.valor.map((x) => `${x.cargoId}=${importeATexto(x.importe)}`) : r.error;

describe("repartirLoMasAntiguo", () => {
  const f1 = cargo("f1", "2026-12-10", "2026-11-01T10:00:00Z", "100.00");
  const f2 = cargo("f2", "2026-11-30", "2026-11-05T10:00:00Z", "50.00");
  const f3 = cargo("f3", null, "2026-10-01T10:00:00Z", "70.00");

  it("ordena por vencimiento (sin vencimiento, al final) y reparte sin pasar lo pendiente de cada cargo", () => {
    expect(dicho(repartirLoMasAntiguo([f1, f2, f3], imp("120.00")))).toEqual([
      "f2=50.00",
      "f1=70.00",
    ]);
    expect(dicho(repartirLoMasAntiguo([f1, f2, f3], imp("40.00")))).toEqual(["f2=40.00"]);
    expect(dicho(repartirLoMasAntiguo([f1, f2, f3], imp("220.00")))).toEqual([
      "f2=50.00",
      "f1=100.00",
      "f3=70.00",
    ]);
  });

  it("con el mismo vencimiento, el más antiguo primero; y con todo igual, por id (siempre el mismo orden)", () => {
    const a = cargo("a", "2026-12-01", "2026-11-02T10:00:00Z", "10.00");
    const b = cargo("b", "2026-12-01", "2026-11-01T10:00:00Z", "10.00");
    const c = cargo("c", "2026-12-01", "2026-11-01T10:00:00Z", "10.00");
    expect(dicho(repartirLoMasAntiguo([a, c, b], imp("25.00")))).toEqual([
      "b=10.00",
      "c=10.00",
      "a=5.00",
    ]);
    expect(dicho(repartirLoMasAntiguo([c, b, a], imp("25.00")))).toEqual([
      "b=10.00",
      "c=10.00",
      "a=5.00",
    ]);
  });

  it("si sobra importe es IMPORTE_SUPERA_LO_ADEUDADO; un importe no positivo, IMPORTE_INVALIDO", () => {
    expect(dicho(repartirLoMasAntiguo([f2], imp("50.01")))).toBe("IMPORTE_SUPERA_LO_ADEUDADO");
    expect(dicho(repartirLoMasAntiguo([], imp("1.00")))).toBe("IMPORTE_SUPERA_LO_ADEUDADO");
    expect(dicho(repartirLoMasAntiguo([f2], imp("0.00")))).toBe("IMPORTE_INVALIDO");
    expect(dicho(repartirLoMasAntiguo([f2], imp("-1.00")))).toBe("IMPORTE_INVALIDO");
  });

  it("los cargos sin pendiente se saltean", () => {
    const saldado = cargo("s", "2026-11-01", "2026-10-01T10:00:00Z", "0.00");
    expect(dicho(repartirLoMasAntiguo([saldado, f2], imp("10.00")))).toEqual(["f2=10.00"]);
  });

  it("propiedad: lo repartido suma el importe, ningún cargo pasa su pendiente y el resultado no depende del orden de entrada", () => {
    const centavos = (c: bigint): Importe =>
      imp(`${c / 100n}.${(c % 100n).toString().padStart(2, "0")}`);
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.record({
            id: fc.uuid(),
            vence: fc.option(fc.integer({ min: 0, max: 400 }), { nil: null }),
            dia: fc.integer({ min: 0, max: 400 }),
            pendiente: fc.bigInt({ min: 0n, max: 100_000n }),
          }),
          { minLength: 1, maxLength: 8, selector: (c) => c.id },
        ),
        fc.bigInt({ min: 1n, max: 800_000n }),
        (cargos, total) => {
          const abiertos = cargos.map((c) => ({
            id: c.id,
            venceEl:
              c.vence === null
                ? null
                : fecha(new Date(Date.UTC(2026, 0, 1 + c.vence)).toISOString().slice(0, 10)),
            registradoEn: new Date(Date.UTC(2026, 0, 1 + c.dia)),
            pendiente: centavos(c.pendiente),
          }));
          const disponible = cargos.reduce((a, c) => a + c.pendiente, 0n);
          const r = repartirLoMasAntiguo(abiertos, centavos(total));
          const otra = repartirLoMasAntiguo([...abiertos].reverse(), centavos(total));
          expect(otra).toEqual(r);
          if (total > disponible) {
            expect(r.ok).toBe(false);
            return;
          }
          expect(r.ok).toBe(true);
          if (!r.ok) return;
          expect(r.valor.reduce((a, x) => sumar(a, x.importe), importeCero(ARS)).unidades).toBe(
            total,
          );
          for (const x of r.valor) {
            const origen = abiertos.find((c) => c.id === x.cargoId);
            expect(x.importe.unidades).toBeGreaterThan(0n);
            expect(x.importe.unidades <= (origen?.pendiente.unidades ?? 0n)).toBe(true);
          }
        },
      ),
    );
  });
});
