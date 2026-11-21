import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../../test/propiedades/configuracion";
import { razonDeContraste } from "../../../primitivas/color/contraste";
import { CARAS_DE_VIDRIERA } from "./caras";
import { cssDelTemaDeLaCarta, temaDeLaCarta, type TemaDeLaCarta } from "./tema-de-la-carta";

/**
 * Propiedades del tema de la carta: para CUALQUIER color elegido y cualquiera de las tres caras, todo texto llega a 7:1 sobre su fondo (el de la carta y el de las superficies), el texto del botón principal
 * sobre el botón también, y los bordes y el foco se distinguen del fondo (3:1). Previene: una carta ilegible por un color mal elegido, con cualquier cara.
 */
const colores = fc
  .tuple(
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
  )
  .map(([r, g, b]) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`);

const dar = (cara: (typeof CARAS_DE_VIDRIERA)[number], color: string): TemaDeLaCarta => {
  const r = temaDeLaCarta(cara, color);
  if (!r.ok) throw new Error("válido esperado");
  return r.valor;
};

describe("temaDeLaCarta: legibilidad con cualquier color", () => {
  it("el texto, el texto suave y «Agotado» llegan a 7:1 sobre el fondo y la superficie", () => {
    fc.assert(
      fc.property(fc.constantFrom(...CARAS_DE_VIDRIERA), colores, (cara, color) => {
        const t = dar(cara, color);
        for (const [nombre, texto] of Object.entries({
          texto: t.texto,
          textoSuave: t.textoSuave,
          agotado: t.agotado,
        }))
          for (const [sobre, fondo] of Object.entries({ fondo: t.fondo, superficie: t.superficie }))
            expect(
              razonDeContraste(texto, fondo),
              `${cara} ${color}: ${nombre} sobre ${sobre} (${texto} / ${fondo})`,
            ).toBeGreaterThanOrEqual(7);
      }),
    );
  });

  it("el texto del botón principal llega a 7:1 sobre el botón", () => {
    fc.assert(
      fc.property(fc.constantFrom(...CARAS_DE_VIDRIERA), colores, (cara, color) => {
        const t = dar(cara, color);
        expect(
          razonDeContraste(t.primariaTexto, t.primariaFondo),
          `${cara} ${color}`,
        ).toBeGreaterThanOrEqual(7);
      }),
    );
  });

  it("el borde y el foco se distinguen del fondo y de la superficie (3:1)", () => {
    fc.assert(
      fc.property(fc.constantFrom(...CARAS_DE_VIDRIERA), colores, (cara, color) => {
        const t = dar(cara, color);
        for (const marca of [t.borde, t.foco])
          for (const fondo of [t.fondo, t.superficie])
            expect(razonDeContraste(marca, fondo), `${cara} ${color}`).toBeGreaterThanOrEqual(3);
      }),
    );
  });

  it("el CSS de cualquier tema solo trae colores `#rrggbb` y es el mismo para el mismo color", () => {
    fc.assert(
      fc.property(fc.constantFrom(...CARAS_DE_VIDRIERA), colores, (cara, color) => {
        const css = cssDelTemaDeLaCarta(dar(cara, color));
        expect(css).toMatch(/^:root\{(--[a-z-]+:#[0-9a-f]{6};)*--[a-z-]+:#[0-9a-f]{6}\}$/);
        expect(css).toBe(cssDelTemaDeLaCarta(dar(cara, color)));
      }),
    );
  });
});
