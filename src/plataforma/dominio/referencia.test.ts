import { describe, expect, it } from "vitest";
import { BYTES_DE_UNA_REFERENCIA, referenciaDeError, referenciaDesdeTexto } from "./referencia";

describe("referenciaDeError", () => {
  it("son 4 bytes de azar", () => {
    expect(BYTES_DE_UNA_REFERENCIA).toBe(4);
  });

  it("arma PD-XXXX-XXXX con 8 dígitos hexadecimales en mayúsculas, en el orden de los bytes", () => {
    expect(referenciaDeError(Uint8Array.of(0x12, 0x34, 0xab, 0xcd))).toBe("PD-1234-ABCD");
    expect(referenciaDeError(Uint8Array.of(0xff, 0xff, 0xff, 0xff))).toBe("PD-FFFF-FFFF");
  });

  it("completa con ceros cada byte de un solo dígito", () => {
    expect(referenciaDeError(Uint8Array.of(0, 0, 0, 0))).toBe("PD-0000-0000");
    expect(referenciaDeError(Uint8Array.of(0, 1, 15, 16))).toBe("PD-0001-0F10");
  });

  it("el mismo azar da siempre la misma referencia (no sortea nada por su cuenta)", () => {
    const azar = Uint8Array.of(9, 8, 7, 6);
    expect(referenciaDeError(azar)).toBe(referenciaDeError(azar));
    expect(referenciaDeError(Uint8Array.of(9, 8, 7, 7))).not.toBe(referenciaDeError(azar));
  });

  it("la referencia que arma es una que referenciaDesdeTexto acepta", () => {
    for (const bytes of [
      [0, 0, 0, 0],
      [255, 0, 255, 0],
      [171, 205, 18, 52],
    ]) {
      const referencia = referenciaDeError(Uint8Array.from(bytes));
      expect(referenciaDesdeTexto(referencia)).toEqual({ ok: true, valor: referencia });
    }
  });

  it("otra cantidad de bytes es un defecto del llamador: RangeError", () => {
    for (const largo of [0, 1, 3, 5, 8]) {
      expect(() => referenciaDeError(new Uint8Array(largo)), String(largo)).toThrow(RangeError);
    }
    expect(() => referenciaDeError(new Uint8Array(3))).toThrow(
      "la referencia necesita 4 bytes de azar",
    );
  });

  it("no modifica el azar recibido", () => {
    const azar = Uint8Array.of(1, 2, 3, 4);
    referenciaDeError(azar);
    expect([...azar]).toEqual([1, 2, 3, 4]);
  });
});

describe("referenciaDesdeTexto", () => {
  it("acepta la forma exacta y la devuelve igual", () => {
    expect(referenciaDesdeTexto("PD-1234-ABCD")).toEqual({ ok: true, valor: "PD-1234-ABCD" });
  });

  it("recorta los espacios y pasa a mayúsculas lo que alguien dictó o copió", () => {
    expect(referenciaDesdeTexto("  pd-12ab-cd34 \n")).toEqual({ ok: true, valor: "PD-12AB-CD34" });
  });

  it("rechaza todo lo que no tenga la forma exacta", () => {
    const malas = [
      "",
      "PD-1234-ABC",
      "PD-1234-ABCDE",
      "PD-123-ABCD",
      "PD1234ABCD",
      "PD-1234ABCD",
      "PD-1234-ABCG",
      "XX-1234-ABCD",
      "PD-1234-ABCD-EFGH",
      "PD-1234- ABCD",
      "PD-12 34-ABCD",
      "APD-1234-ABCD",
      "PD-1234-ABCDZ",
      "PD-1234-ABCD\nPD-1234-ABCD",
    ];
    for (const texto of malas) {
      expect(referenciaDesdeTexto(texto), JSON.stringify(texto)).toEqual({
        ok: false,
        error: "REFERENCIA_INVALIDA",
      });
    }
  });
});
