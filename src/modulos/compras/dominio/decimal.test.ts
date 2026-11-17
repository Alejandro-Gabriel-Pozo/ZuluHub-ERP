import { describe, expect, it } from "vitest";
import {
  ESCALA_DE_LA_CANTIDAD,
  ESCALA_DEL_IMPORTE,
  ESCALA_DEL_PRECIO,
  MAXIMO_DE_UNIDADES_EXACTAS,
  UNO_DE_CANTIDAD,
  UNO_DE_IMPORTE,
  UNO_DE_PRECIO,
  leerCantidad,
  leerCantidadPositiva,
  leerImporte,
  leerPrecio,
  leerPrecioPositivo,
  textoDeCantidad,
  textoDeImporte,
  textoDePrecio,
} from "./decimal";

describe("decimales de compras", () => {
  it("las escalas son las de las primitivas", () => {
    expect([ESCALA_DE_LA_CANTIDAD, ESCALA_DEL_PRECIO, ESCALA_DEL_IMPORTE]).toEqual([4, 6, 2]);
    expect([UNO_DE_CANTIDAD, UNO_DE_PRECIO, UNO_DE_IMPORTE]).toEqual([10_000n, 1_000_000n, 100n]);
    expect(MAXIMO_DE_UNIDADES_EXACTAS).toBe(10n ** 18n - 1n);
  });

  it("lee en unidades mínimas", () => {
    expect(leerCantidad("46.6")).toBe(466_000n);
    expect(leerPrecio("0.000001")).toBe(1n);
    expect(leerImporte("512600.00")).toBe(51_260_000n);
    expect(leerImporte("-1.5")).toBe(-150n);
  });

  it("un texto inválido da null (decimales de más, forma no canónica, signo, vacío, negativo donde no corresponde)", () => {
    for (const t of ["", "1,5", "01", "+1", "abc", "1.23456", "-1"])
      expect(leerCantidad(t), t).toBeNull();
    expect(leerPrecio("1.1234567")).toBeNull();
    expect(leerPrecio("-1")).toBeNull();
    expect(leerImporte("1.234")).toBeNull();
  });

  it("lo que no es un error de valor no se traga", () => {
    expect(() => leerCantidad(undefined as never)).toThrow();
  });

  it("positivos: cero y negativos dan null", () => {
    expect(leerCantidadPositiva("0.0001")).toBe(1n);
    expect(leerCantidadPositiva("0")).toBeNull();
    expect(leerCantidadPositiva("x")).toBeNull();
    expect(leerPrecioPositivo("0.000001")).toBe(1n);
    expect(leerPrecioPositivo("0")).toBeNull();
    expect(leerPrecioPositivo("x")).toBeNull();
  });

  it("escribe con la escala de cada dato", () => {
    expect(textoDeCantidad(466_000n)).toBe("46.6000");
    expect(textoDePrecio(10_729_613_734n)).toBe("10729.613734");
    expect(textoDeImporte(51_260_000n)).toBe("512600.00");
  });
});
