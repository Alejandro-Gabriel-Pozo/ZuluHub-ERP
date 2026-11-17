import { describe, expect, it } from "vitest";
import { celdasDeMesa, huellaDeMesa, seSuperponen } from "./celdas";
import { formaDeMesa, numeroDeMesa, posicionDeMesa, tamanoDeMesa } from "./mesa";

describe("mesa", () => {
  it("el número va de 1 a 99 y es entero", () => {
    expect(numeroDeMesa(1).ok).toBe(true);
    expect(numeroDeMesa(99).ok).toBe(true);
    for (const n of [0, 100, -1, 1.5, Number.NaN]) {
      expect(numeroDeMesa(n)).toEqual({ ok: false, error: "NUMERO_DE_MESA_INVALIDO" });
    }
  });

  it("forma y tamaño son listas cerradas", () => {
    expect(formaDeMesa("LARGA")).toEqual({ ok: true, valor: "LARGA" });
    expect(formaDeMesa("larga")).toEqual({ ok: false, error: "FORMA_INVALIDA" });
    expect(formaDeMesa("toString")).toEqual({ ok: false, error: "FORMA_INVALIDA" });
    expect(tamanoDeMesa("GRANDE")).toEqual({ ok: true, valor: "GRANDE" });
    expect(tamanoDeMesa("")).toEqual({ ok: false, error: "TAMANO_INVALIDO" });
  });

  it("la esquina cae dentro de 14 × 9", () => {
    expect(posicionDeMesa({ columna: 14, fila: 9 }).ok).toBe(true);
    for (const p of [
      { columna: 0, fila: 1 },
      { columna: 15, fila: 1 },
      { columna: 1, fila: 0 },
      { columna: 1, fila: 10 },
      { columna: 1.5, fila: 1 },
    ]) {
      expect(posicionDeMesa(p)).toEqual({ ok: false, error: "MESA_FUERA_DEL_SALON" });
    }
  });
});

describe("celdas de la mesa", () => {
  it("la huella sale de la tabla del prototipo", () => {
    expect(huellaDeMesa("REDONDA", "CHICA")).toEqual({ ancho: 2, alto: 2 });
    expect(huellaDeMesa("CUADRADA", "MEDIANA")).toEqual({ ancho: 3, alto: 3 });
    expect(huellaDeMesa("REDONDA", "GRANDE")).toEqual({ ancho: 4, alto: 4 });
    expect(huellaDeMesa("LARGA", "CHICA")).toEqual({ ancho: 3, alto: 2 });
    expect(huellaDeMesa("LARGA", "MEDIANA")).toEqual({ ancho: 4, alto: 2 });
    expect(huellaDeMesa("LARGA", "GRANDE")).toEqual({ ancho: 5, alto: 2 });
  });

  it("ocupa ancho × alto casillas desde su esquina", () => {
    const r = celdasDeMesa({ forma: "LARGA", tamano: "MEDIANA", columna: 7, fila: 1 });
    expect(r.ok && r.valor.length).toBe(8);
    expect(r.ok && r.valor[0]).toEqual({ columna: 7, fila: 1 });
    expect(r.ok && r.valor[7]).toEqual({ columna: 10, fila: 2 });
  });

  it("se sale del salón en el borde exacto y no antes", () => {
    const base = { forma: "CUADRADA", tamano: "GRANDE", fila: 1 } as const;
    expect(celdasDeMesa({ ...base, columna: 11 }).ok).toBe(true);
    expect(celdasDeMesa({ ...base, columna: 12 })).toEqual({
      ok: false,
      error: "MESA_FUERA_DEL_SALON",
    });
    expect(celdasDeMesa({ ...base, columna: 11, fila: 6 }).ok).toBe(true);
    expect(celdasDeMesa({ ...base, columna: 11, fila: 7 }).ok).toBe(false);
  });

  it("dos mesas se superponen solo si comparten una casilla", () => {
    const a = celdasDeMesa({ forma: "REDONDA", tamano: "CHICA", columna: 1, fila: 1 });
    const pegada = celdasDeMesa({ forma: "REDONDA", tamano: "CHICA", columna: 3, fila: 1 });
    const pisada = celdasDeMesa({ forma: "REDONDA", tamano: "CHICA", columna: 2, fila: 2 });
    if (!a.ok || !pegada.ok || !pisada.ok) throw new Error("armado");
    expect(seSuperponen(a.valor, pegada.valor)).toBe(false);
    expect(seSuperponen(a.valor, pisada.valor)).toBe(true);
  });
});
