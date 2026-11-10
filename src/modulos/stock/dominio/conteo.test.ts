import { describe, expect, it } from "vitest";
import { cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import {
  cantidadConSignoATexto,
  cantidadConSignoDesdeTexto,
  type CantidadConSigno,
} from "../../../primitivas/cantidad/con-signo";
import { diferenciaDeConteo, renglonesDeConteo, type RegistroDeConteo } from "./conteo";

const cs = (texto: string): CantidadConSigno => {
  const r = cantidadConSignoDesdeTexto(texto);
  if (!r.ok) throw new Error(texto);
  return r.valor;
};
const reg = (
  articuloId: string,
  orden: number,
  contada: string,
  existencia: string,
): RegistroDeConteo => ({
  articuloId,
  orden,
  cantidadContada: cantidadDesdeTexto(contada),
  existenciaAlRegistrar: cs(existencia),
});
const texto = (r: ReturnType<typeof renglonesDeConteo>) =>
  r.ok ? r.valor.map((x) => [x.articuloId, cantidadConSignoATexto(x.diferencia)]) : r.error;

describe("diferenciaDeConteo: contada − existencia al registrar", () => {
  it("positiva si contó de más, negativa si contó de menos, cero si coincide", () => {
    const d = (contada: string, existencia: string) => {
      const r = diferenciaDeConteo(cantidadDesdeTexto(contada), cs(existencia));
      return r.ok ? cantidadConSignoATexto(r.valor) : r.error;
    };
    expect(d("10", "7.5")).toBe("2.5000");
    expect(d("3", "5")).toBe("-2.0000");
    expect(d("4", "4")).toBe("0.0000");
    expect(d("0", "5")).toBe("-5.0000");
    expect(d("0.0001", "0")).toBe("0.0001");
  });

  it("con existencia negativa la diferencia crece", () => {
    const r = diferenciaDeConteo(cantidadDesdeTexto("2"), cs("-3"));
    expect(r.ok && cantidadConSignoATexto(r.valor)).toBe("5.0000");
  });

  it("fuera del rango de la cantidad con signo: FUERA_DE_RANGO", () => {
    const r = diferenciaDeConteo(cantidadDesdeTexto("99999999999999.9999"), cs("-0.0001"));
    expect(r).toEqual({ ok: false, error: "FUERA_DE_RANGO" });
  });
});

describe("renglonesDeConteo", () => {
  it("sin registros no se aplica (D132)", () => {
    expect(texto(renglonesDeConteo([]))).toBe("CONTEO_SIN_REGISTROS");
  });

  it("un renglón por artículo que difiere, con la diferencia con signo, ordenados por artículo", () => {
    const r = renglonesDeConteo([
      reg("c", 1, "5", "9"),
      reg("a", 2, "10", "4"),
      reg("b", 3, "7", "7"),
    ]);
    expect(texto(r)).toEqual([
      ["a", "6.0000"],
      ["c", "-4.0000"],
    ]);
  });

  it("de varios registros del mismo artículo vale el de mayor orden, esté donde esté", () => {
    expect(
      texto(
        renglonesDeConteo([reg("a", 3, "8", "5"), reg("a", 1, "1", "5"), reg("a", 2, "2", "5")]),
      ),
    ).toEqual([["a", "3.0000"]]);
    // el último puede ser el que deja la diferencia en cero: no hay renglón
    expect(texto(renglonesDeConteo([reg("a", 1, "1", "5"), reg("a", 2, "5", "5")]))).toEqual([]);
  });

  it("con dos registros del mismo orden se queda el primero (el orden de la base es único: es solo determinismo)", () => {
    expect(texto(renglonesDeConteo([reg("a", 1, "8", "5"), reg("a", 1, "9", "5")]))).toEqual([
      ["a", "3.0000"],
    ]);
  });

  it("con registros y sin ninguna diferencia devuelve la lista vacía, no un error", () => {
    expect(texto(renglonesDeConteo([reg("a", 1, "5", "5"), reg("b", 2, "0", "0")]))).toEqual([]);
  });

  it("lo no contado no aparece", () => {
    expect(texto(renglonesDeConteo([reg("a", 1, "1", "2")]))).toEqual([["a", "-1.0000"]]);
  });

  it("propaga FUERA_DE_RANGO", () => {
    expect(texto(renglonesDeConteo([reg("a", 1, "99999999999999.9999", "-0.0001")]))).toBe(
      "FUERA_DE_RANGO",
    );
  });
});
