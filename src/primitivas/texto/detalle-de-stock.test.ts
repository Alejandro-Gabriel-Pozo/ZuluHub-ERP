import { describe, expect, it } from "vitest";
import { detalleDeStockDesdeTexto, LARGO_MAXIMO_DEL_DETALLE_DE_STOCK } from "./detalle-de-stock";

describe("detalleDeStockDesdeTexto", () => {
  it("acepta un detalle de una línea hasta el largo máximo, sin exigir una letra", () => {
    expect(detalleDeStockDesdeTexto("Factura 12")).toEqual({ ok: true, valor: "Factura 12" });
    expect(detalleDeStockDesdeTexto("#12")).toEqual({ ok: true, valor: "#12" });
    const justo = "a".repeat(LARGO_MAXIMO_DEL_DETALLE_DE_STOCK);
    expect(detalleDeStockDesdeTexto(justo)).toEqual({ ok: true, valor: justo });
  });

  it("rechaza el vacío, lo que pasa del largo máximo y los caracteres que no están en la lista de permitidos", () => {
    expect(detalleDeStockDesdeTexto("")).toEqual({ ok: false, error: "VACIO" });
    expect(detalleDeStockDesdeTexto("a".repeat(LARGO_MAXIMO_DEL_DETALLE_DE_STOCK + 1))).toEqual({
      ok: false,
      error: "DEMASIADO_LARGO",
    });
    for (const texto of ["Dos\nlíneas", "<b>x</b>", "=SUMA(A1)", "Con 🍕", "-fórmula"]) {
      expect(detalleDeStockDesdeTexto(texto).ok, texto).toBe(false);
    }
  });
});
