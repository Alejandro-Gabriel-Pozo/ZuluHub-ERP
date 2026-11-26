import { describe, expect, it } from "vitest";
import { importeATexto, importeDesdeTexto } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import {
  PLAZO_MAXIMO_EN_DIAS,
  PLAZO_MINIMO_EN_DIAS,
  decidirCambioDeCondiciones,
  decidirCambioDeEstado,
  huellaDeHabilitacion,
  limiteValido,
  motivoValido,
  plazoValido,
} from "./condiciones";

const pesos = (texto: string) => importeDesdeTexto(ARS, texto);

describe("plazoValido", () => {
  it("acepta un entero de 1 a 365 días (el 30 y el 60 de la pantalla incluidos)", () => {
    for (const p of [PLAZO_MINIMO_EN_DIAS, 30, 60, PLAZO_MAXIMO_EN_DIAS]) {
      expect(plazoValido(p), `plazo ${p}`).toEqual({ ok: true, valor: p });
    }
  });

  it("rechaza 0, 366, negativos, fracciones, no finitos y lo que no es un número", () => {
    for (const [i, p] of [
      0,
      366,
      -1,
      30.5,
      Number.NaN,
      Infinity,
      "30",
      null,
      undefined,
      {},
      1n,
    ].entries()) {
      expect(plazoValido(p), `caso ${i}`).toEqual({
        ok: false,
        error: "PLAZO_INVALIDO",
      });
    }
  });
});

describe("limiteValido", () => {
  it("acepta dígitos con hasta 2 decimales, de 0 a 999999999.99, y lo devuelve en pesos exactos", () => {
    for (const [texto, canonico] of [
      ["0", "0.00"],
      ["100000", "100000.00"],
      ["100000.5", "100000.50"],
      ["250000.50", "250000.50"],
      ["999999999.99", "999999999.99"],
    ] as const) {
      const r = limiteValido(texto);
      expect(r.ok, texto).toBe(true);
      if (r.ok) {
        expect(importeATexto(r.valor), texto).toBe(canonico);
        expect(r.valor.moneda).toBe("ARS");
      }
    }
  });

  it("rechaza negativos, más de 2 decimales, más de 9 enteros, notación científica, coma, vacío y lo que no es texto", () => {
    for (const [i, texto] of [
      "-1",
      "10.123",
      "1000000000",
      "1e3",
      "10,50",
      "",
      " 10",
      "10 ",
      "+10",
      ".5",
      "Infinity",
      100000,
      null,
      undefined,
      { monto: "1" },
    ].entries()) {
      expect(limiteValido(texto), `caso ${i}`).toEqual({
        ok: false,
        error: "LIMITE_INVALIDO",
      });
    }
  });
});

describe("motivoValido", () => {
  it("devuelve el motivo recortado o MOTIVO_INVALIDO", () => {
    expect(motivoValido("Pagos vencidos")).toEqual({ ok: true, valor: "Pagos vencidos" });
    for (const texto of ["", "a".repeat(301), "Dos\nlíneas", "<x>", 5, null, undefined]) {
      expect(motivoValido(texto), String(texto)).toEqual({ ok: false, error: "MOTIVO_INVALIDO" });
    }
  });
});

describe("huellaDeHabilitacion", () => {
  const base = {
    parteId: "00000000-0000-4000-8000-000000000001",
    plazoDias: 30,
    limite: pesos("10"),
  };

  it("es la misma para el mismo pedido ('10' y '10.00' son lo mismo) y cambia con cualquier campo", () => {
    const h = huellaDeHabilitacion(base);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(huellaDeHabilitacion({ ...base, limite: pesos("10.00") })).toBe(h);
    expect(huellaDeHabilitacion({ ...base, limite: pesos("10.01") })).not.toBe(h);
    expect(huellaDeHabilitacion({ ...base, plazoDias: 60 })).not.toBe(h);
    expect(
      huellaDeHabilitacion({ ...base, parteId: "00000000-0000-4000-8000-000000000002" }),
    ).not.toBe(h);
  });

  it("vector fijo (sha256 de la lista JSON calculado aparte con sha256sum): no cambia sin que lo note una prueba (un cambio daría falsas CLAVE_REUTILIZADA a lo ya guardado)", () => {
    expect(huellaDeHabilitacion(base)).toBe(
      "33b029f4bf806426b7db1115856cb92cc1ac90dd4c98904a38ffdad85aa96325",
    );
  });
});

describe("decidirCambioDeEstado", () => {
  it("pedir el estado que ya tiene es YA_ESTABA; el otro, CAMBIAR", () => {
    expect(decidirCambioDeEstado("HABILITADA", "HABILITADA")).toBe("YA_ESTABA");
    expect(decidirCambioDeEstado("SUSPENDIDA", "SUSPENDIDA")).toBe("YA_ESTABA");
    expect(decidirCambioDeEstado("HABILITADA", "SUSPENDIDA")).toBe("CAMBIAR");
    expect(decidirCambioDeEstado("SUSPENDIDA", "HABILITADA")).toBe("CAMBIAR");
  });
});

describe("decidirCambioDeCondiciones", () => {
  const actual = { plazoDias: 30, limite: pesos("100") };

  it("las mismas condiciones son SIN_CAMBIOS ('100' y '100.00' son iguales); otro plazo o límite, CAMBIAR", () => {
    expect(decidirCambioDeCondiciones(actual, { plazoDias: 30, limite: pesos("100.00") })).toBe(
      "SIN_CAMBIOS",
    );
    expect(decidirCambioDeCondiciones(actual, { plazoDias: 60, limite: pesos("100") })).toBe(
      "CAMBIAR",
    );
    expect(decidirCambioDeCondiciones(actual, { plazoDias: 30, limite: pesos("100.01") })).toBe(
      "CAMBIAR",
    );
  });
});
