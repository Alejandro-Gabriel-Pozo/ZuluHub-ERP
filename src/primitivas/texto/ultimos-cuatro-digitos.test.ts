import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../test/propiedades/configuracion";
import { ultimosCuatroDigitosDesdeTexto } from "./ultimos-cuatro-digitos";

const MALO = { ok: false, error: "ULTIMOS_CUATRO_DIGITOS_INVALIDOS" } as const;

describe("últimos cuatro dígitos", () => {
  it("los ceros a la izquierda cuentan y se conservan", () => {
    expect(ultimosCuatroDigitosDesdeTexto("0042")).toEqual({ ok: true, valor: "0042" });
    expect(ultimosCuatroDigitosDesdeTexto("0000")).toEqual({ ok: true, valor: "0000" });
    expect(ultimosCuatroDigitosDesdeTexto("1234")).toEqual({ ok: true, valor: "1234" });
  });

  it("rechaza 3 y 5 dígitos, letras, espacios, signos y vacío", () => {
    for (const malo of ["", "123", "12345", "12a4", "12 4", " 123", "123 ", "1234\n", "-123", "+123", "1.23", "１２３４", "١٢٣٤"]) {
      expect(ultimosCuatroDigitosDesdeTexto(malo), JSON.stringify(malo)).toEqual(MALO);
    }
  });

  it("propiedad: cualquier grupo de 4 dígitos entra y vuelve idéntico", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[0-9]{4}$/), (cuatro) => {
        expect(ultimosCuatroDigitosDesdeTexto(cuatro)).toEqual({ ok: true, valor: cuatro });
      }),
    );
  });

  it("propiedad: con un largo distinto de 4 nunca entra", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[0-9]{0,12}$/), (digitos) => {
        fc.pre(digitos.length !== 4);
        expect(ultimosCuatroDigitosDesdeTexto(digitos).ok).toBe(false);
      }),
    );
  });
});
