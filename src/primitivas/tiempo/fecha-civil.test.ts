import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../test/propiedades/configuracion";
import { fechaCivilDesdeTexto } from "./fecha-civil";

const valida = (texto: string) => fechaCivilDesdeTexto(texto);

describe("fecha civil: fechas reales", () => {
  it.each(["2026-10-11", "0001-01-01", "9999-12-31", "2026-01-31", "2026-04-30", "2026-12-31"])(
    "acepta %s",
    (texto) => {
      expect(valida(texto)).toEqual({ ok: true, valor: texto });
    },
  );

  it("calendario gregoriano: bisiestos y no bisiestos", () => {
    expect(valida("2028-02-29").ok).toBe(true); // múltiplo de 4
    expect(valida("2000-02-29").ok).toBe(true); // múltiplo de 400
    expect(valida("0004-02-29").ok).toBe(true);
    expect(valida("2026-02-29").ok).toBe(false);
    expect(valida("1900-02-29").ok).toBe(false); // múltiplo de 100 y no de 400
    expect(valida("2100-02-29").ok).toBe(false);
    expect(valida("2026-02-28").ok).toBe(true);
    expect(valida("2026-02-30").ok).toBe(false);
  });

  it("el último día de cada mes entra y el siguiente no", () => {
    const ultimos = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    ultimos.forEach((ultimo, i) => {
      const mes = String(i + 1).padStart(2, "0");
      expect(valida(`2026-${mes}-${String(ultimo).padStart(2, "0")}`).ok).toBe(true);
      expect(valida(`2026-${mes}-${String(ultimo + 1).padStart(2, "0")}`).ok).toBe(false);
    });
  });
});

describe("fecha civil: lo que se rechaza", () => {
  it.each([
    "2026-00-10",
    "2026-13-10",
    "2026-10-00",
    "2026-10-32",
    "0000-01-01",
    "2026-1-10",
    "2026-10-1",
    "26-10-10",
    "20261-10-10",
    "2026/10/10",
    "2026-10-10 ",
    " 2026-10-10",
    "2026-10-10T00:00:00Z",
    "2026-10-10\n",
    "",
    "hoy",
    "٢٠٢٦-١٠-١٠",
  ])("rechaza %j", (texto) => {
    expect(valida(texto)).toEqual({ ok: false, error: "FECHA_CIVIL_INVALIDA" });
  });

  it("propiedad: toda fecha real del calendario se acepta y se devuelve idéntica", () => {
    fc.assert(
      fc.property(
        fc.date({
          min: new Date("0001-01-01Z"),
          max: new Date("9999-12-31Z"),
          noInvalidDate: true,
        }),
        (d) => {
          const texto = d.toISOString().slice(0, 10);
          expect(valida(texto)).toEqual({ ok: true, valor: texto });
        },
      ),
    );
  });
});
