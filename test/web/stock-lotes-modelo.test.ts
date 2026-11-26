import { describe, expect, it } from "vitest";
import { texto } from "../../src/capacidades/vocabulario/vocabulario";
import {
  armarLosLotes,
  armarLosVencimientos,
  hrefDeLotes,
  hrefDeVencimientos,
  leerLosLotes,
  type LotesDeLaComposicion,
  type VencimientosDeLaComposicion,
} from "../../apps/web/ui/plantillas/stock/lotes/modelo-de-lotes";

/** El modelo de vista de la pestaña «Lotes» (maqueta `stock-lotes.html`): fechas dd/mm/aaaa, «Sin asignar» sin fecha, estados de Vencimientos, horizontes y direcciones. Puro. */
const textoDe = (clave: Parameters<typeof texto>[1], valores?: Record<string, string>) =>
  texto({}, clave, valores);
const LOTES: LotesDeLaComposicion = {
  articulos: [
    { id: "a1", nombre: "Queso cremoso" },
    { id: "a2", nombre: "Pollo" },
  ],
  articuloId: "a1",
  unidadId: "KILOGRAMO",
  lotes: [
    {
      loteId: "l1",
      codigo: "Q-1104",
      vence: "2026-12-02",
      existencia: "3.0000",
      disponible: "3.0000",
      sinAsignar: false,
    },
    {
      loteId: "l2",
      codigo: "SIN_ASIGNAR",
      vence: null,
      existencia: "1.5000",
      disponible: "0.0000",
      sinAsignar: true,
    },
  ],
};
const VENCEN: VencimientosDeLaComposicion = {
  dias: 7,
  vencimientos: [
    {
      loteId: "l3",
      nombre: "Crema",
      codigo: "C-554",
      vence: "2026-11-24",
      existencia: "2.0000",
      unidadId: "KILOGRAMO",
      estado: "VENCIDO",
    },
    {
      loteId: "l1",
      nombre: "Queso cremoso",
      codigo: "Q-1104",
      vence: "2026-11-25",
      existencia: "3.0000",
      unidadId: "KILOGRAMO",
      estado: "VENCE_HOY",
    },
    {
      loteId: "l4",
      nombre: "Pollo entero",
      codigo: "P-88",
      vence: "2026-11-29",
      existencia: "8.0000",
      unidadId: "KILOGRAMO",
      estado: null,
    },
  ],
};

describe("modelo de lotes", () => {
  it("el «Sin asignar» se rotula con su texto y no lleva fecha; la fecha sale dd/mm/aaaa y la cantidad con su unidad", () => {
    const v = armarLosLotes(LOTES, textoDe);
    expect(v.filas.map((f) => [f.codigo, f.vence])).toEqual([
      ["Q-1104", "02/12/2026"],
      ["Sin asignar", null],
    ]);
    expect(v.filas[0]?.existencia).toBe("3 Kilogramo");
    expect(v.opciones.map((o) => [o.nombre, o.href, o.actual])).toEqual([
      ["Queso cremoso", "/stock/lotes?articulo=a1", true],
      ["Pollo", "/stock/lotes?articulo=a2", false],
    ]);
    expect(v.hrefDeVencimientos).toBe("/stock/lotes?vista=vencimientos");
  });

  it("una fecha inválida no se muestra y los horizontes marcan el aplicado", () => {
    const roto = armarLosVencimientos(
      { dias: 30, vencimientos: [{ ...VENCEN.vencimientos[0]!, vence: "2026-13-40" }] },
      textoDe,
    );
    expect(roto.filas[0]?.vence).toBe("");
    expect(roto.horizontes.map((h) => [h.texto, h.href, h.actual])).toEqual([
      ["Vence en los próximos 7 días", "/stock/lotes?vista=vencimientos&dias=7", false],
      ["Vence en los próximos 30 días", "/stock/lotes?vista=vencimientos&dias=30", true],
      ["Vence en los próximos 90 días", "/stock/lotes?vista=vencimientos&dias=90", false],
    ]);
  });

  it("las direcciones y la lectura de la dirección: solo texto, lo repetido o vacío se descarta", () => {
    expect(hrefDeLotes()).toBe("/stock/lotes");
    expect(hrefDeVencimientos()).toBe("/stock/lotes?vista=vencimientos");
    expect(leerLosLotes({ vista: "vencimientos", dias: "30", articulo: "a1" })).toEqual({
      vencimientos: true,
      dias: "30",
      articuloId: "a1",
    });
    expect(leerLosLotes({ vista: ["x", "y"], dias: "", articulo: undefined })).toEqual({
      vencimientos: false,
    });
    expect(leerLosLotes({ vista: "otra" }).vencimientos).toBe(false);
  });
});
