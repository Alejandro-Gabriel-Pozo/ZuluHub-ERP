import { describe, expect, it } from "vitest";
import {
  confirmarVersion,
  estadoDeVersion,
  siguienteNumeroDeVersion,
  versionVigente,
  type VersionConfirmada,
} from "./vigencia";

const t = (ms: number) => new Date(ms);
const v = (numero: number, desde: number): VersionConfirmada => ({
  numero,
  vigenteDesde: t(desde),
});

describe("versionVigente", () => {
  it("sin versiones no hay vigente", () => {
    expect(versionVigente([], t(100))).toBeNull();
  });

  it("si todas son futuras no hay vigente", () => {
    expect(versionVigente([v(1, 200), v(2, 300)], t(100))).toBeNull();
  });

  it("una versión rige desde su instante exacto (inclusive)", () => {
    const v1 = v(1, 100);
    expect(versionVigente([v1], t(99))).toBeNull();
    expect(versionVigente([v1], t(100))).toBe(v1);
    expect(versionVigente([v1], t(101))).toBe(v1);
  });

  it("gana la de mayor vigencia entre las que ya empezaron", () => {
    const [v1, v2, v3] = [v(1, 100), v(2, 200), v(3, 300)] as const;
    expect(versionVigente([v1, v2, v3], t(250))).toBe(v2);
    expect(versionVigente([v3, v2, v1], t(250))).toBe(v2);
    expect(versionVigente([v1, v2, v3], t(300))).toBe(v3);
  });

  it("una versión confirmada después con vigencia anterior no pisa a la que ya regía", () => {
    const v1 = v(1, 100);
    const v2 = v(2, 300);
    const v3 = v(3, 200); // confirmada tercera pero rige antes que v2
    expect(versionVigente([v1, v2, v3], t(250))).toBe(v3);
    expect(versionVigente([v1, v2, v3], t(350))).toBe(v2);
  });

  it("con la misma vigencia gana el número mayor, sin importar el orden", () => {
    const v1 = v(1, 100);
    const v2 = v(2, 100);
    expect(versionVigente([v1, v2], t(100))).toBe(v2);
    expect(versionVigente([v2, v1], t(100))).toBe(v2);
  });

  it("con el mismo número y la misma vigencia (dato corrupto) se queda con la primera", () => {
    const a = v(1, 100);
    const b = v(1, 100);
    expect(versionVigente([a, b], t(100))).toBe(a);
    expect(versionVigente([b, a], t(100))).toBe(b);
  });

  it("anular una versión futura es confirmar otra con la misma vigencia", () => {
    const v1 = v(1, 100);
    const futura = v(2, 500);
    const anuladora = v(3, 500);
    expect(versionVigente([v1, futura, anuladora], t(600))).toBe(anuladora);
    expect(versionVigente([v1, futura, anuladora], t(400))).toBe(v1);
  });

  it("una fecha inválida es un error de programación", () => {
    expect(() => versionVigente([v(1, 100)], new Date(Number.NaN))).toThrow(
      new RangeError("fecha inválida"),
    );
    expect(() => versionVigente([v(1, Number.NaN)], t(100))).toThrow(
      new RangeError("fecha inválida"),
    );
  });
});

describe("estadoDeVersion", () => {
  const v1 = v(1, 100);
  const v2 = v(2, 200);
  const v3 = v(3, 300);
  const todas = [v1, v2, v3];

  it("calcula futura, vigente y reemplazada", () => {
    expect(estadoDeVersion(todas, v1, t(250))).toBe("REEMPLAZADA");
    expect(estadoDeVersion(todas, v2, t(250))).toBe("VIGENTE");
    expect(estadoDeVersion(todas, v3, t(250))).toBe("FUTURA");
  });

  it("la versión se identifica por su número, no por la referencia del objeto", () => {
    expect(estadoDeVersion(todas, { ...v2 }, t(250))).toBe("VIGENTE");
    expect(estadoDeVersion(todas, { ...v1 }, t(250))).toBe("REEMPLAZADA");
  });

  it("una versión que ya empezó y no está en la lista no está vigente", () => {
    expect(estadoDeVersion([], v1, t(250))).toBe("REEMPLAZADA");
    expect(estadoDeVersion([v3], v1, t(250))).toBe("REEMPLAZADA");
  });

  it("el instante de inicio ya no es futura", () => {
    expect(estadoDeVersion(todas, v3, t(299))).toBe("FUTURA");
    expect(estadoDeVersion(todas, v3, t(300))).toBe("VIGENTE");
    expect(estadoDeVersion(todas, v2, t(300))).toBe("REEMPLAZADA");
  });

  it("una versión anulada por otra con la misma vigencia queda reemplazada al empezar", () => {
    const anulada = v(4, 500);
    const anuladora = v(5, 500);
    const lista = [...todas, anulada, anuladora];
    expect(estadoDeVersion(lista, anulada, t(499))).toBe("FUTURA");
    expect(estadoDeVersion(lista, anulada, t(500))).toBe("REEMPLAZADA");
    expect(estadoDeVersion(lista, anuladora, t(500))).toBe("VIGENTE");
  });
});

describe("siguienteNumeroDeVersion", () => {
  it("la primera es 1 y después máximo + 1", () => {
    expect(siguienteNumeroDeVersion([])).toBe(1);
    expect(siguienteNumeroDeVersion([v(1, 0)])).toBe(2);
    expect(siguienteNumeroDeVersion([v(3, 0), v(1, 0), v(2, 0)])).toBe(4);
  });
});

describe("confirmarVersion", () => {
  const ahora = t(1000);

  it("fija número, vigencia, instante y motivo recortado", () => {
    const r = confirmarVersion([v(1, 0), v(2, 0)], {
      ahora,
      vigenteDesde: t(2000),
      motivo: "  cambio de domicilio  ",
    });
    expect(r).toEqual({
      ok: true,
      valor: {
        numero: 3,
        vigenteDesde: t(2000),
        confirmadaEn: ahora,
        motivo: "cambio de domicilio",
      },
    });
  });

  it("la vigencia puede ser exactamente ahora", () => {
    const r = confirmarVersion([], { ahora, vigenteDesde: t(1000), motivo: "alta" });
    expect(r.ok).toBe(true);
  });

  it("sin vigencia retroactiva", () => {
    expect(confirmarVersion([], { ahora, vigenteDesde: t(999), motivo: "alta" })).toEqual({
      ok: false,
      error: "VIGENCIA_RETROACTIVA",
    });
  });

  it("el motivo es obligatorio, y se informa antes que la vigencia", () => {
    expect(confirmarVersion([], { ahora, vigenteDesde: t(1000), motivo: "" })).toEqual({
      ok: false,
      error: "MOTIVO_OBLIGATORIO",
    });
    expect(confirmarVersion([], { ahora, vigenteDesde: t(1000), motivo: "  \t" })).toEqual({
      ok: false,
      error: "MOTIVO_OBLIGATORIO",
    });
    expect(confirmarVersion([], { ahora, vigenteDesde: t(0), motivo: "" })).toEqual({
      ok: false,
      error: "MOTIVO_OBLIGATORIO",
    });
  });

  it("una fecha inválida es un error de programación", () => {
    expect(() =>
      confirmarVersion([], { ahora, vigenteDesde: new Date(Number.NaN), motivo: "x" }),
    ).toThrow(RangeError);
    expect(() =>
      confirmarVersion([], { ahora: new Date(Number.NaN), vigenteDesde: t(1), motivo: "x" }),
    ).toThrow(RangeError);
  });
});
