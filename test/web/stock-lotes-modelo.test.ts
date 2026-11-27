import { describe, expect, it } from "vitest";
import { texto } from "../../src/capacidades/vocabulario/vocabulario";
import {
  armarLosLotes,
  hrefDeCorregir,
  hrefDeReasignar,
  loteParaCorregir,
  loteParaReasignar,
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
      version: 3,
      depositos: [{ depositoId: "d1", existencia: "3.0000" }],
    },
    {
      loteId: "l2",
      codigo: "SIN_ASIGNAR",
      vence: null,
      existencia: "1.5000",
      disponible: "0.0000",
      sinAsignar: true,
      version: 1,
      depositos: [{ depositoId: "d1", existencia: "1.5000" }],
    },
  ],
  control: { activo: true },
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

  it("cada estado sale con su texto y solo «Vencido» se marca como vencido; sin estado no hay texto", () => {
    const v = armarLosVencimientos(VENCEN, textoDe);
    expect(v.filas.map((f) => [f.articulo, f.codigo, f.vence, f.estado, f.vencido])).toEqual([
      ["Crema", "C-554", "24/11/2026", "Vencido", true],
      ["Queso cremoso", "Q-1104", "25/11/2026", "Vence hoy", false],
      ["Pollo entero", "P-88", "29/11/2026", null, false],
    ]);
    expect(v.filas.map((f) => f.existencia)).toEqual(["2 Kilogramo", "3 Kilogramo", "8 Kilogramo"]);
  });

  it("sin unidad la cantidad sale sin unidad, y existencia y disponible salen cada uno con lo suyo", () => {
    const v = armarLosLotes({ ...LOTES, unidadId: null }, textoDe);
    expect(v.filas.map((f) => [f.existencia, f.disponible])).toEqual([
      ["3", "3"],
      ["1,5", "0"],
    ]);
  });

  it("el artículo y los días de la dirección se descartan si están vacíos o repetidos, y la vista solo es Vencimientos con ese valor exacto", () => {
    expect(leerLosLotes({ articulo: "", dias: "" })).toEqual({ vencimientos: false });
    expect(leerLosLotes({ articulo: ["a"], dias: ["1"] })).toEqual({ vencimientos: false });
    expect(leerLosLotes({ articulo: "a", dias: "0" })).toEqual({
      vencimientos: false,
      articuloId: "a",
      dias: "0",
    });
    expect(leerLosLotes({ vista: "vencimientos" })).toEqual({ vencimientos: true });
    expect(leerLosLotes({ vista: "" }).vencimientos).toBe(false);
  });
});

describe("escritura de lotes (STK-E1)", () => {
  it("las direcciones de Corregir y Reasignar llevan el artículo y el lote escapados", () => {
    expect(hrefDeCorregir("a 1", "l&2")).toBe("/stock/lotes/corregir?articulo=a+1&lote=l%262");
    expect(hrefDeReasignar("a1", "l2")).toBe("/stock/lotes/reasignar?articulo=a1&lote=l2");
  });

  it("«Corregir» se ofrece en el lote con fechas, no en el «Sin asignar»; «Reasignar» solo en el «Sin asignar» con existencia positiva", () => {
    const v = armarLosLotes(LOTES, textoDe);
    expect(v.filas.map((f) => [f.hrefDeCorregir, f.hrefDeReasignar])).toEqual([
      ["/stock/lotes/corregir?articulo=a1&lote=l1", null],
      [null, "/stock/lotes/reasignar?articulo=a1&lote=l2"],
    ]);
    for (const existencia of ["0.0000", "-2.0000"]) {
      const sin = armarLosLotes(
        { ...LOTES, lotes: LOTES.lotes.map((l) => (l.sinAsignar ? { ...l, existencia } : l)) },
        textoDe,
      );
      expect(sin.filas[1]?.hrefDeReasignar, existencia).toBeNull();
    }
  });

  it("el artículo se ve controlado solo con el control activo; sin artículo no hay ninguna dirección", () => {
    expect(armarLosLotes(LOTES, textoDe).controlado).toBe(true);
    expect(armarLosLotes({ ...LOTES, control: { activo: false } }, textoDe).controlado).toBe(false);
    expect(armarLosLotes({ ...LOTES, control: null }, textoDe).controlado).toBe(false);
    const vacio = armarLosLotes({ ...LOTES, articuloId: null }, textoDe);
    expect(vacio.filas.every((f) => f.hrefDeCorregir === null && f.hrefDeReasignar === null)).toBe(
      true,
    );
  });

  it("el lote a corregir es uno del artículo con fechas y trae su versión", () => {
    expect(loteParaCorregir(LOTES, "l1")).toEqual({
      codigo: "Q-1104",
      vence: "2026-12-02",
      version: 3,
    });
    expect(loteParaCorregir(LOTES, "l2")).toBeNull();
    expect(loteParaCorregir(LOTES, "otro")).toBeNull();
    expect(loteParaCorregir(LOTES, undefined)).toBeNull();
  });

  it("reasignar: sale del «Sin asignar» con existencia, solo en los depósitos donde la tiene, y va a lotes que ya existen", () => {
    const depositos = [
      { id: "d1", nombre: "Salón" },
      { id: "d2", nombre: "Cocina" },
    ];
    expect(loteParaReasignar(LOTES, "l2", depositos, textoDe)).toEqual({
      origen: "Sin asignar",
      unidadId: "KILOGRAMO",
      depositos: [{ valor: "d1", etiqueta: "Salón" }],
      destinos: [{ valor: "l1", etiqueta: "Q-1104" }],
    });
    expect(loteParaReasignar(LOTES, "l1", depositos, textoDe)).toBeNull();
    expect(loteParaReasignar(LOTES, "nada", depositos, textoDe)).toBeNull();
    const sinExistencia = {
      ...LOTES,
      lotes: LOTES.lotes.map((l) => (l.sinAsignar ? { ...l, existencia: "0.0000" } : l)),
    };
    expect(loteParaReasignar(sinExistencia, "l2", depositos, textoDe)).toBeNull();
  });
});
