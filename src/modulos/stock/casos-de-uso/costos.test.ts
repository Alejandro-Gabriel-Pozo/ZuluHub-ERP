import { describe, expect, it } from "vitest";
import { precioUnitarioATexto } from "../../../primitivas/dinero/precio-unitario";
import { costosDeclaradosDe, leerCostoDeclarado } from "./costos";
import { precioUnitarioDesdeTexto } from "../../../primitivas/dinero/precio-unitario";

describe("leerCostoDeclarado", () => {
  it("acepta un decimal canónico mayor que cero con hasta 6 decimales, tal cual", () => {
    for (const texto of ["0.000001", "1", "12.5", "999999999999.999999"]) {
      const leido = leerCostoDeclarado(texto);
      expect(leido.ok, texto).toBe(true);
      if (leido.ok) expect(precioUnitarioATexto(leido.valor)).toMatch(/^\d+\.\d{6}$/);
    }
  });

  it("rechaza con COSTO_INVALIDO lo que no es texto decimal canónico, el cero, lo negativo, los 7 decimales y lo que no entra en numeric(18,6)", () => {
    for (const valor of [
      "",
      " 1",
      "1 ",
      "1,5",
      "+1",
      "-1",
      "0",
      "0.0",
      "0.000000",
      "1.1234567",
      "1e3",
      "01",
      "NaN",
      "Infinity",
      "1000000000000",
      "9".repeat(41),
      5,
      null,
      undefined,
      {},
      [],
      true,
    ]) {
      expect(leerCostoDeclarado(valor), JSON.stringify(valor) ?? "undefined").toEqual({
        ok: false,
        error: "COSTO_INVALIDO",
      });
    }
  });
});

describe("costosDeclaradosDe", () => {
  it("indexa por (depósito, artículo) solo los renglones que declararon costo", () => {
    const costo = precioUnitarioDesdeTexto("4");
    const mapa = costosDeclaradosDe("dep", [
      { articuloId: "a", costoUnitario: costo },
      { articuloId: "b", costoUnitario: null },
    ]);
    expect([...mapa.keys()]).toEqual(["dep|a"]);
    expect(mapa.get("dep|a")).toBe(costo);
  });
});
