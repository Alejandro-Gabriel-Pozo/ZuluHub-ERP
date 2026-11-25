import { describe, expect, it } from "vitest";
import {
  hayCambios,
  nivelVigente,
  opcionesDeNivel,
  type TextosDeNivelDeCompras,
} from "../../apps/web/ui/plantillas/compras/nivel/modelo-de-nivel-de-compras";

/** Compras PR 11: el modelo puro de «Nivel de compras». */
const textos: TextosDeNivelDeCompras = {
  titulo: "Nivel de compras",
  guardar: "Guardar",
  niveles: { COMPRA_SIMPLE: "Sin factura", CON_COMPROBANTE: "Con factura" },
};

describe("modelo de «Nivel de compras»", () => {
  it("las opciones salen en el orden del servidor, con el texto aprobado", () => {
    expect(opcionesDeNivel(["COMPRA_SIMPLE", "CON_COMPROBANTE"], textos)).toEqual([
      { valor: "COMPRA_SIMPLE", etiqueta: "Sin factura" },
      { valor: "CON_COMPROBANTE", etiqueta: "Con factura" },
    ]);
  });

  it("un nivel sin texto aprobado (la fase 5) no se dibuja: nunca un código crudo", () => {
    expect(opcionesDeNivel(["COMPRA_SIMPLE", "RECEPCION_SEPARADA", "TRES_VIAS"], textos)).toEqual([
      { valor: "COMPRA_SIMPLE", etiqueta: "Sin factura" },
    ]);
  });

  it("«Guardar» solo si lo elegido difiere de lo vigente", () => {
    expect(hayCambios("COMPRA_SIMPLE", "COMPRA_SIMPLE")).toBe(false);
    expect(hayCambios("COMPRA_SIMPLE", "CON_COMPROBANTE")).toBe(true);
  });

  it("el nivel vigente es el del último guardado, o el que trajo el rechazo por versión, o el de al abrir", () => {
    expect(nivelVigente({ estado: "INICIAL" }, "COMPRA_SIMPLE")).toBe("COMPRA_SIMPLE");
    expect(
      nivelVigente({ estado: "HECHO", nivel: "CON_COMPROBANTE", version: 2 }, "COMPRA_SIMPLE"),
    ).toBe("CON_COMPROBANTE");
    expect(
      nivelVigente(
        {
          estado: "ERROR",
          error: { codigo: "COMPRAS_ACCION_NO_PERMITIDA" } as never,
          vigente: { nivel: "CON_COMPROBANTE", version: 2 },
        },
        "COMPRA_SIMPLE",
      ),
    ).toBe("CON_COMPROBANTE");
    expect(
      nivelVigente(
        {
          estado: "ERROR",
          error: { codigo: "COMPRAS_ACCION_NO_PERMITIDA" } as never,
          vigente: null,
        },
        "COMPRA_SIMPLE",
      ),
    ).toBe("COMPRA_SIMPLE");
  });
});
