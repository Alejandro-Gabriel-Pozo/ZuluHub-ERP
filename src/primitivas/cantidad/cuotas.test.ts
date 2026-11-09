import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../test/propiedades/configuracion";
import { cuotasDesdeTexto, MAXIMO_DE_CUOTAS, MINIMO_DE_CUOTAS } from "./cuotas";

const MALO = { ok: false, error: "CUOTAS_INVALIDAS" } as const;

describe("cuotas", () => {
  it("el rango es de 1 a 36 y viaja como entero", () => {
    expect(MINIMO_DE_CUOTAS).toBe(1);
    expect(MAXIMO_DE_CUOTAS).toBe(36);
    expect(cuotasDesdeTexto("1")).toEqual({ ok: true, valor: 1 });
    expect(cuotasDesdeTexto("36")).toEqual({ ok: true, valor: 36 });
    expect(cuotasDesdeTexto("12")).toEqual({ ok: true, valor: 12 });
  });

  it("rechaza 0, 37, decimales, negativos, ceros a la izquierda y texto", () => {
    for (const malo of ["0", "37", "1.5", "-1", "01", "", " 3", "3 ", "doce", "1e1", "+3", "100", "٣"]) {
      expect(cuotasDesdeTexto(malo), JSON.stringify(malo)).toEqual(MALO);
    }
  });

  it("propiedad: entran exactamente los enteros del 1 al 36", () => {
    fc.assert(
      fc.property(fc.integer({ min: -50, max: 200 }), (n) => {
        const esperado = n >= 1 && n <= 36;
        const resultado = cuotasDesdeTexto(String(n));
        expect(resultado.ok).toBe(esperado);
        if (resultado.ok) expect(resultado.valor).toBe(n);
      }),
    );
  });

  it("propiedad: un texto que no es un entero canónico nunca entra", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 6 }), (texto) => {
        fc.pre(!/^[1-9][0-9]?$/.test(texto));
        expect(cuotasDesdeTexto(texto).ok).toBe(false);
      }),
    );
  });
});
