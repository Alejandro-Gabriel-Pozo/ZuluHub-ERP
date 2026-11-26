import { describe, expect, it } from "vitest";
import { importeATexto, importeDesdeTexto } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import { disponibleDe } from "./disponible";

const pesos = (texto: string) => importeDesdeTexto(ARS, texto);

describe("disponibleDe", () => {
  const limite = pesos("1000");
  const texto = (r: ReturnType<typeof disponibleDe>) => ({
    disponible: importeATexto(r.disponible),
    excedido: r.excedido,
  });

  it("disponible = límite − saldo", () => {
    expect(texto(disponibleDe(limite, pesos("400.25")))).toEqual({
      disponible: "599.75",
      excedido: false,
    });
    expect(texto(disponibleDe(limite, pesos("0")))).toEqual({
      disponible: "1000.00",
      excedido: false,
    });
  });

  it("con el saldo igual al límite el disponible es cero y NO está excedido", () => {
    expect(texto(disponibleDe(limite, pesos("1000")))).toEqual({
      disponible: "0.00",
      excedido: false,
    });
  });

  it("con el saldo por encima del límite el disponible es cero (nunca negativo) y figura excedido", () => {
    expect(texto(disponibleDe(limite, pesos("1000.01")))).toEqual({
      disponible: "0.00",
      excedido: true,
    });
    expect(texto(disponibleDe(limite, pesos("5000")))).toEqual({
      disponible: "0.00",
      excedido: true,
    });
  });

  it("un saldo a favor (negativo) suma al disponible", () => {
    expect(texto(disponibleDe(limite, pesos("-200")))).toEqual({
      disponible: "1200.00",
      excedido: false,
    });
  });

  it("con límite cero, cualquier deuda es exceso", () => {
    expect(texto(disponibleDe(pesos("0"), pesos("0.01")))).toEqual({
      disponible: "0.00",
      excedido: true,
    });
    expect(texto(disponibleDe(pesos("0"), pesos("0")))).toEqual({
      disponible: "0.00",
      excedido: false,
    });
  });
});
