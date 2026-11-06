import { describe, expect, it } from "vitest";
import { reglaDePagina } from "../../apps/web/ui/plantillas/facturacion/impresion/regla-de-pagina";
import {
  ALTO_A4_MM,
  ANCHO_A4_MM,
  ANCHO_TICKET_MM,
  escalaPara,
  mmAPx,
  pxAMm,
} from "../../apps/web/ui/plantillas/facturacion/impresion/geometria";

/** Las medidas del papel y la regla `@page` (pura): el A4 es exacto y el ticket lleva su largo en mm. */

describe("geometría del papel", () => {
  it("el A4 mide 210 x 297 mm exactos (297,5 mm genera dos páginas) y el ticket 80 mm", () => {
    expect([ANCHO_A4_MM, ALTO_A4_MM, ANCHO_TICKET_MM]).toEqual([210, 297, 80]);
  });

  it("96 px de CSS son 25,4 mm: ida y vuelta", () => {
    expect(mmAPx(25.4)).toBeCloseTo(96, 10);
    expect(mmAPx(297)).toBeCloseTo(1122.52, 2);
    expect(pxAMm(mmAPx(123.4))).toBeCloseTo(123.4, 10);
  });
});

describe("@page del formato elegido", () => {
  it("el A4 usa size: A4 y margen cero", () => {
    expect(reglaDePagina("A4", null)).toBe("@page{size:A4;margin:0}");
    expect(reglaDePagina("A4", 150)).toBe("@page{size:A4;margin:0}");
  });

  it("el ticket lleva su largo medido en mm (nunca `auto`, que Chromium no respeta) y nada hasta tenerlo", () => {
    expect(reglaDePagina("TICKET", 183)).toBe("@page{size:80mm 183mm;margin:0}");
    expect(reglaDePagina("TICKET", null)).toBeNull();
  });
});

describe("escala de la vista previa", () => {
  it("entra en el ancho disponible y nunca agranda", () => {
    expect(escalaPara(360, 720)).toBeCloseTo(0.5, 10);
    expect(escalaPara(1600, 720)).toBe(1);
    expect(escalaPara(0, 720)).toBe(1);
  });
});
