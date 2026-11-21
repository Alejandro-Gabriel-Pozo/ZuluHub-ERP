import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CATEGORIAS_DE_SALIDA,
  CATEGORIAS_ELEGIBLES_DE_SALIDA,
  LARGO_MAXIMO_DE_LA_REFERENCIA,
  LARGO_MAXIMO_DEL_CONCEPTO,
  ORIGEN_DEL_MOVIMIENTO_DE_DINERO,
  conceptoDesdeTexto,
  huellaDelMovimientoDeDinero,
  referenciaDesdeTexto,
  reglaDeLaCategoria,
  type CamposDeLaHuellaDelMovimientoDeDinero,
} from "./movimiento-de-dinero";

const BASE: CamposDeLaHuellaDelMovimientoDeDinero = {
  sentido: "SALIDA",
  sesionId: "s1",
  importe: "10.00",
  categoria: "GASTO_MENOR",
  concepto: null,
  motivo: "Flete",
  terceroNombre: "Pérez",
  terceroPersonaId: null,
  referencia: null,
  devuelveA: null,
};

describe("categorías de salida", () => {
  it("son seis y la devolución no se elige", () => {
    expect(CATEGORIAS_DE_SALIDA).toHaveLength(6);
    expect(CATEGORIAS_ELEGIBLES_DE_SALIDA).toHaveLength(5);
    expect(CATEGORIAS_ELEGIBLES_DE_SALIDA).not.toContain("DEVOLUCION_DE_UN_COBRO");
  });
  it("el retiro exime de tercero, «otro» lleva motivo propio y la devolución exige el ingreso original; ninguna otra", () => {
    for (const c of CATEGORIAS_DE_SALIDA) {
      expect(reglaDeLaCategoria(c)).toEqual({
        eximeDeTercero: c === "RETIRO_DEL_DUENO",
        motivoPropio: c === "OTRO",
        exigeIngresoOriginal: c === "DEVOLUCION_DE_UN_COBRO",
      });
    }
  });
});

describe("concepto y referencia", () => {
  it("vacío o en blanco es null; se recorta y se compacta", () => {
    expect(conceptoDesdeTexto(null)).toEqual({ ok: true, valor: null });
    expect(conceptoDesdeTexto("   ")).toEqual({ ok: true, valor: null });
    expect(conceptoDesdeTexto("  Seña   de mesa ")).toEqual({ ok: true, valor: "Seña de mesa" });
    expect(referenciaDesdeTexto(" Rec  123 ")).toEqual({ ok: true, valor: "Rec 123" });
  });
  it("admite el largo máximo exacto y rechaza uno más", () => {
    const c = "x".repeat(LARGO_MAXIMO_DEL_CONCEPTO);
    expect(conceptoDesdeTexto(c)).toEqual({ ok: true, valor: c });
    expect(conceptoDesdeTexto(c + "x")).toEqual({ ok: false, error: "CONCEPTO_INVALIDO" });
    const r = "x".repeat(LARGO_MAXIMO_DE_LA_REFERENCIA);
    expect(referenciaDesdeTexto(r)).toEqual({ ok: true, valor: r });
    expect(referenciaDesdeTexto(r + "x")).toEqual({ ok: false, error: "REFERENCIA_INVALIDA" });
  });
  it("lo que no está en la lista de permitidos se rechaza", () => {
    for (const malo of ["con <b>", "dos\nlíneas", "emoji 😀"]) {
      expect(conceptoDesdeTexto(malo)).toEqual({ ok: false, error: "CONCEPTO_INVALIDO" });
      expect(referenciaDesdeTexto(malo)).toEqual({ ok: false, error: "REFERENCIA_INVALIDA" });
    }
  });
});

describe("huella", () => {
  it("mismo contenido, misma huella (sha256 hex)", () => {
    expect(huellaDelMovimientoDeDinero(BASE)).toBe(huellaDelMovimientoDeDinero({ ...BASE }));
    expect(huellaDelMovimientoDeDinero(BASE)).toMatch(/^[0-9a-f]{64}$/);
  });
  it("un campo distinto, otra huella", () => {
    const variantes: Partial<CamposDeLaHuellaDelMovimientoDeDinero>[] = [
      { sentido: "ENTRADA" },
      { sesionId: "s2" },
      { importe: "10.01" },
      { categoria: "OTRO" },
      { concepto: "c" },
      { motivo: "Otro" },
      { terceroNombre: "Gómez" },
      { terceroPersonaId: "p" },
      { referencia: "r" },
      { devuelveA: "e" },
    ];
    const huellas = new Set(
      [BASE, ...variantes.map((v) => ({ ...BASE, ...v }))].map(huellaDelMovimientoDeDinero),
    );
    expect(huellas.size).toBe(variantes.length + 1);
  });
  it("es el sha256 de la lista ordenada de sus campos, marcada con el nombre del acto", () => {
    const esperada = createHash("sha256")
      .update(
        JSON.stringify([
          "movimiento_de_dinero",
          "SALIDA",
          "s1",
          "10.00",
          "GASTO_MENOR",
          null,
          "Flete",
          "Pérez",
          null,
          null,
          null,
        ]),
      )
      .digest("hex");
    expect(huellaDelMovimientoDeDinero(BASE)).toBe(esperada);
  });
});

describe("origen de los cobros del acto", () => {
  it("es el que la base compara por texto (cobro.origen_tipo)", () => {
    expect(ORIGEN_DEL_MOVIMIENTO_DE_DINERO).toBe("caja.movimiento_de_dinero");
  });
});
