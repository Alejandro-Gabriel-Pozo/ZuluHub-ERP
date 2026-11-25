import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { celdaDeLaBiblioteca, seEscribeComoNumero, textoInofensivo } from "./celdas-de-xlsx";

describe("el decimal: número solo si es exacto, si no texto exacto", () => {
  it.each([
    "1369499.91",
    "266252.40",
    "0.00",
    "13312.620000",
    "-2",
    "8.940000",
    "27740.75",
    "0.000001",
    "100",
  ])("%s se escribe como número", (t) => expect(seEscribeComoNumero(t)).toBe(true));
  it.each([
    "12345678901234567.89", // 19 dígitos: el número binario lo redondea
    "1234567890123456", // 16 dígitos
    "0.1234567890123456",
    "1e21",
    "abc",
    "",
    "1,5",
    " 1",
    "+1",
  ])("%s NO se escribe como número", (t) => expect(seEscribeComoNumero(t)).toBe(false));

  it("un importe de 17 dígitos sale como texto exacto, nunca redondeado", () => {
    expect(
      celdaDeLaBiblioteca({ tipo: "decimal", valor: "12345678901234567.89", decimales: 2 }),
    ).toEqual({
      value: "12345678901234567.89",
      type: String,
    });
  });

  it("propiedad: lo que se escribe como número vuelve idéntico (nunca se cambia un importe)", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 17n }),
        fc.integer({ min: 0, max: 6 }),
        (n, d) => {
          const base = n.toString().padStart(d + 1, "0");
          const texto = d === 0 ? base : `${base.slice(0, -d)}.${base.slice(-d)}`;
          const celda = celdaDeLaBiblioteca({ tipo: "decimal", valor: texto, decimales: 2 });
          if (celda !== null && celda.type === Number) {
            const valor = celda.value as number;
            expect(Number(texto)).toBe(valor);
            expect(BigInt(Math.round(valor * 10 ** d))).toBe(n);
          } else {
            expect(celda).toEqual({ value: texto, type: String });
          }
        },
      ),
    );
  });
});

describe("el texto: sin fórmulas", () => {
  it.each(['=HYPERLINK("http://x")', "+cmd|' /C calc'!A0", "-2+3", "@SUM(A1)", "\tdato", "\rdato"])(
    "%j lleva una comilla simple antepuesta",
    (t) => expect(textoInofensivo(t)).toBe(`'${t}`),
  );
  it.each(["Carnes del Sur", "Bife angosto", "1+1", "a=b", "'ya con comilla"])(
    "%j queda igual",
    (t) => expect(textoInofensivo(t)).toBe(t),
  );
});

describe("la fecha civil: el día, sin corrimiento", () => {
  it("2026-10-23 es la serie 46318 a medianoche UTC, con formato aaaa-mm-dd", () => {
    const celda = celdaDeLaBiblioteca({ tipo: "fecha", valor: "2026-10-23" });
    expect(celda).toMatchObject({ type: Date, format: "yyyy-mm-dd" });
    expect((celda as { value: Date }).value.toISOString()).toBe("2026-10-23T00:00:00.000Z");
  });
  it("una fecha que no existe se rechaza (no se escribe un día inventado)", () => {
    expect(() => celdaDeLaBiblioteca({ tipo: "fecha", valor: "2026-02-30" })).toThrow(RangeError);
    expect(() => celdaDeLaBiblioteca({ tipo: "fecha", valor: "hoy" })).toThrow(RangeError);
  });
});

describe("lo demás", () => {
  it("una celda vacía queda vacía (nunca cero)", () => {
    expect(celdaDeLaBiblioteca(null)).toBeNull();
  });
  it("un entero fuera del rango seguro se rechaza", () => {
    expect(() => celdaDeLaBiblioteca({ tipo: "entero", valor: 2 ** 60 })).toThrow(RangeError);
  });
});
