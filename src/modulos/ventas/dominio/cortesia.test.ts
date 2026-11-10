import { describe, expect, it } from "vitest";
import { importeDesdeTexto } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import { precioUnitarioDesdeTexto } from "../../../primitivas/dinero/precio-unitario";
import { lineaEsACero, tipoDeCortesia } from "./cortesia";

const precio = precioUnitarioDesdeTexto;
const total = (t: string) => importeDesdeTexto(ARS, t);

describe("cortesía", () => {
  it("una línea vale cero solo con precio exactamente 0", () => {
    expect(lineaEsACero(precio("0"))).toBe(true);
    expect(lineaEsACero(precio("0.000001"))).toBe(false);
  });
  it("total 0 es cortesía TOTAL; una línea a 0 con total mayor es PARCIAL; si no, no es cortesía", () => {
    expect(tipoDeCortesia(total("0"), [precio("0")])).toBe("TOTAL");
    expect(tipoDeCortesia(total("0"), [precio("0.000001")])).toBe("TOTAL");
    expect(tipoDeCortesia(total("5"), [precio("0"), precio("5")])).toBe("PARCIAL");
    expect(tipoDeCortesia(total("5"), [precio("5")])).toBeNull();
    expect(tipoDeCortesia(total("0.01"), [])).toBeNull();
  });
});
