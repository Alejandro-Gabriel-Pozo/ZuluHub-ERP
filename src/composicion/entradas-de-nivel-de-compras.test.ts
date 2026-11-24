import { describe, expect, it } from "vitest";
import { entradaDeGuardarElNivel } from "./entradas-de-nivel-de-compras";

/** Compras PR 11: la frontera de «Nivel de compras» (lista de permitidos). Sin base ni servidor. */
describe("entradas de «Nivel de compras»", () => {
  it("acepta los dos niveles estándar con su versión, como número o como texto de dígitos", () => {
    expect(entradaDeGuardarElNivel({ nivel: "COMPRA_SIMPLE", versionEsperada: 1 })).toEqual({
      ok: true,
      valor: { nivel: "COMPRA_SIMPLE", versionEsperada: 1 },
    });
    expect(entradaDeGuardarElNivel({ nivel: "CON_COMPROBANTE", versionEsperada: "7" })).toEqual({
      ok: true,
      valor: { nivel: "CON_COMPROBANTE", versionEsperada: 7 },
    });
  });

  it.each([
    ["N3 (fase 5)", { nivel: "RECEPCION_SEPARADA", versionEsperada: 1 }],
    ["N4 (fase 5)", { nivel: "TRES_VIAS", versionEsperada: 1 }],
    ["un nivel inventado", { nivel: "OTRO", versionEsperada: 1 }],
    ["un nivel vacío", { nivel: "", versionEsperada: 1 }],
    ["un nivel que no es texto", { nivel: 1, versionEsperada: 1 }],
    ["sin versión", { nivel: "CON_COMPROBANTE" }],
    ["versión decimal", { nivel: "CON_COMPROBANTE", versionEsperada: "1.5" }],
    ["versión negativa", { nivel: "CON_COMPROBANTE", versionEsperada: "-1" }],
    ["clave de más (empresaId)", { nivel: "CON_COMPROBANTE", versionEsperada: 1, empresaId: "x" }],
    ["nada", null],
    ["un texto", "CON_COMPROBANTE"],
  ])("rechaza %s", (_nombre, crudo) => {
    expect(entradaDeGuardarElNivel(crudo).ok).toBe(false);
  });
});
