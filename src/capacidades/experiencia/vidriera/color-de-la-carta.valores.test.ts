import { describe, expect, it } from "vitest";
import { colorDeLaCarta } from "./color-de-la-carta";

/**
 * Valores exactos del oscurecido (matiz y saturación se conservan; baja solo la luminosidad, de a un punto, hasta llegar a 7:1 con texto blanco). Los esperados se calcularon aparte con una
 * implementación independiente de HSL y de la razón WCAG, no con esta función. Cubre cada rama de la conversión: máximo en rojo (con verde mayor y menor que azul: matiz con y sin vuelta),
 * en verde, en azul, y el gris (sin matiz ni saturación).
 */
describe("colorDeLaCarta: el color oscurecido, valor por valor", () => {
  it.each([
    ["#0e7490", "#0b5e74", 7.32, "máximo en azul"],
    ["#808080", "#595959", 7, "gris: sin matiz ni saturación"],
    ["#cc3366", "#a32952", 7, "máximo en rojo, verde menor que azul (matiz negativo)"],
    ["#e0603a", "#9a3618", 7.2, "máximo en rojo, verde mayor que azul"],
    ["#c0392b", "#9e2f23", 7.27, "rojo con poco verde y azul"],
    ["#2a9d8f", "#1a6158", 7.25, "máximo en verde"],
    ["#3355cc", "#2f4ebc", 7.15, "azul intenso"],
    ["#8e44ad", "#7b3b96", 7.22, "violeta"],
  ])("%s → %s (contraste %s; %s)", (elegido, esperado, contraste) => {
    const r = colorDeLaCarta(elegido);
    expect(r).toEqual({
      ok: true,
      valor: { hex: esperado, textoSobreColor: "BLANCO", ajustado: true, contraste },
    });
  });

  it("el oscurecido es el primero que llega: un punto más de luminosidad ya no llegaba (no se oscurece de más)", () => {
    // #808080 (luminosidad 50) baja hasta #595959 (35): es el primero con 7,00; no el negro.
    const r = colorDeLaCarta("#808080");
    expect(r.ok && r.valor.hex).toBe("#595959");
  });

  it("los colores que ya se leen con su texto no pasan por el oscurecido y devuelven los mismos valores en minúsculas", () => {
    expect(colorDeLaCarta("#33AA55")).toEqual({
      ok: true,
      valor: { hex: "#33aa55", textoSobreColor: "NEGRO", ajustado: false, contraste: 7.02 },
    });
  });
});
