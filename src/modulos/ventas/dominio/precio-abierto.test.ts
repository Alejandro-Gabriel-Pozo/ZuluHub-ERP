import { describe, expect, it } from "vitest";
import {
  precioUnitarioATexto,
  precioUnitarioDesdeTexto,
} from "../../../primitivas/dinero/precio-unitario";
import { decidirPrecioDeLaLinea, importeDePrecioAbierto } from "./precio-abierto";

const catalogo = precioUnitarioDesdeTexto("1000");
const texto = (r: ReturnType<typeof importeDePrecioAbierto>) =>
  r.ok ? precioUnitarioATexto(r.valor) : r.error;

describe("importe de un precio abierto (decisión 179)", () => {
  it("dígitos y hasta 2 decimales con punto, de hasta 9 enteros", () => {
    expect(texto(importeDePrecioAbierto("850"))).toBe("850.000000");
    expect(texto(importeDePrecioAbierto("850.5"))).toBe("850.500000");
    expect(texto(importeDePrecioAbierto("850.55"))).toBe("850.550000");
    expect(texto(importeDePrecioAbierto("0"))).toBe("0.000000");
    expect(texto(importeDePrecioAbierto("999999999.99"))).toBe("999999999.990000");
  });
  it("rechaza signo, coma, exponente, texto, más decimales, vacío, espacios y exceso de enteros", () => {
    for (const malo of [
      "-1",
      "+1",
      "5,5",
      "1e3",
      "abc",
      "1.234",
      "",
      " 5",
      "5 ",
      ".5",
      "5.",
      "1000000000",
      "5\n",
    ]) {
      expect(texto(importeDePrecioAbierto(malo)), malo).toBe("IMPORTE_INVALIDO");
    }
  });
});

describe("qué precio lleva la línea", () => {
  it("con precio de catálogo y sin importe del cliente, el del catálogo", () => {
    expect(decidirPrecioDeLaLinea({ precioCotizado: catalogo, precioAbierto: undefined })).toEqual({
      ok: true,
      valor: { origen: "CATALOGO", precioUnitario: catalogo },
    });
  });
  it("con precio de catálogo, un importe del cliente se rechaza (el servidor manda), aunque sea inválido", () => {
    for (const enviado of ["1", "0", "basura"]) {
      expect(decidirPrecioDeLaLinea({ precioCotizado: catalogo, precioAbierto: enviado })).toEqual({
        ok: false,
        error: "PRECIO_ABIERTO_NO_PERMITIDO",
      });
    }
  });
  it("sin precio de catálogo y sin importe, no se vende", () => {
    expect(decidirPrecioDeLaLinea({ precioCotizado: null, precioAbierto: undefined })).toEqual({
      ok: false,
      error: "PRODUCTO_SIN_PRECIO",
    });
  });
  it("sin precio de catálogo, el importe escrito es el precio con origen ABIERTO; inválido es IMPORTE_INVALIDO", () => {
    const r = decidirPrecioDeLaLinea({ precioCotizado: null, precioAbierto: "850.50" });
    expect(r.ok && r.valor.origen).toBe("ABIERTO");
    expect(r.ok && precioUnitarioATexto(r.valor.precioUnitario)).toBe("850.500000");
    expect(decidirPrecioDeLaLinea({ precioCotizado: null, precioAbierto: "-5" })).toEqual({
      ok: false,
      error: "IMPORTE_INVALIDO",
    });
  });
});
