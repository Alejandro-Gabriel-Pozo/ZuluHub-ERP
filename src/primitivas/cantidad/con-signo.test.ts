import { describe, expect, it } from "vitest";
import { cantidadATexto, cantidadDesdeTexto } from "./cantidad";
import {
  cantidadConSignoATexto,
  cantidadConSignoDesdeCantidad,
  cantidadConSignoDesdeTexto,
  compararConSigno,
  multiplicarCantidades,
  negarConSigno,
  restarConSigno,
  sumarConSigno,
  valorAbsolutoDe,
  type CantidadConSigno,
} from "./con-signo";
import { ErrorDeValor } from "./errores";

const MAXIMO = "99999999999999.9999";
const MINIMO = "-99999999999999.9999";

function cs(texto: string): CantidadConSigno {
  const r = cantidadConSignoDesdeTexto(texto);
  if (!r.ok) throw new Error(`no parsea ${texto}: ${r.error.message}`);
  return r.valor;
}

function codigoDe(accion: () => unknown): string | undefined {
  try {
    accion();
  } catch (e) {
    if (e instanceof ErrorDeValor) return e.codigo;
    throw e;
  }
  return undefined;
}

const texto = (r: ReturnType<typeof sumarConSigno>): string =>
  r.ok ? cantidadConSignoATexto(r.valor) : `error ${r.error.codigo}`;

describe("cantidadConSignoDesdeTexto y cantidadConSignoATexto", () => {
  it.each([
    ["0", "0.0000"],
    ["3", "3.0000"],
    ["-3", "-3.0000"],
    ["0.0001", "0.0001"],
    ["-0.0001", "-0.0001"],
    ["12.5", "12.5000"],
    ["-12.5", "-12.5000"],
    [MAXIMO, MAXIMO],
    [MINIMO, MINIMO],
  ])("%s → %s", (entrada, canonico) => {
    expect(cantidadConSignoATexto(cs(entrada))).toBe(canonico);
  });

  it.each([
    ["", "FORMATO_INVALIDO"],
    ["abc", "FORMATO_INVALIDO"],
    ["1,5", "FORMATO_INVALIDO"],
    ["+1", "FORMATO_INVALIDO"],
    ["--1", "FORMATO_INVALIDO"],
    ["- 1", "FORMATO_INVALIDO"],
    ["-0", "FORMATO_INVALIDO"],
    ["-0.0000", "FORMATO_INVALIDO"],
    ["1e3", "FORMATO_INVALIDO"],
    ["01", "FORMATO_INVALIDO"],
    ["0.00001", "DECIMALES_DE_MAS"],
    ["-0.00001", "DECIMALES_DE_MAS"],
    ["100000000000000.0000", "FUERA_DE_RANGO"],
    ["-100000000000000.0000", "FUERA_DE_RANGO"],
    ["99999999999999.99990", "DECIMALES_DE_MAS"],
  ])("rechaza %j con %s, sin lanzar", (entrada, codigo) => {
    const r = cantidadConSignoDesdeTexto(entrada);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.codigo).toBe(codigo);
  });

  it("el error dice qué campo falló", () => {
    const r = cantidadConSignoDesdeTexto("x");
    expect(r.ok ? "" : r.error.message).toBe(
      "FORMATO_INVALIDO: cantidad con signo: no es un decimal en forma canónica",
    );
    const fuera = cantidadConSignoDesdeTexto("-100000000000000");
    expect(fuera.ok ? "" : fuera.error.message).toBe(
      "FUERA_DE_RANGO: cantidad con signo: fuera del rango admitido",
    );
  });

  it("lo que no es un error de valor es un defecto: se lanza, no se convierte en Resultado", () => {
    expect(() => cantidadConSignoDesdeTexto(undefined as unknown as string)).toThrow(TypeError);
  });

  it("el valor construido es inmutable", () => {
    expect(Object.isFrozen(cs("1"))).toBe(true);
  });
});

describe("sumarConSigno y restarConSigno", () => {
  it("suman y restan con signo", () => {
    expect(texto(sumarConSigno(cs("1.5"), cs("2.25")))).toBe("3.7500");
    expect(texto(sumarConSigno(cs("1.5"), cs("-2.25")))).toBe("-0.7500");
    expect(texto(sumarConSigno(cs("-1.5"), cs("-2.25")))).toBe("-3.7500");
    expect(texto(restarConSigno(cs("1.5"), cs("2.25")))).toBe("-0.7500");
    expect(texto(restarConSigno(cs("-1.5"), cs("-2.25")))).toBe("0.7500");
    expect(texto(restarConSigno(cs("1.5"), cs("-2.25")))).toBe("3.7500");
  });

  it("llegan justo al borde del rango y no lo pasan", () => {
    expect(texto(sumarConSigno(cs("99999999999999.9998"), cs("0.0001")))).toBe(MAXIMO);
    expect(texto(sumarConSigno(cs(MAXIMO), cs("0.0001")))).toBe("error FUERA_DE_RANGO");
    expect(texto(sumarConSigno(cs("-99999999999999.9998"), cs("-0.0001")))).toBe(MINIMO);
    expect(texto(sumarConSigno(cs(MINIMO), cs("-0.0001")))).toBe("error FUERA_DE_RANGO");
    expect(texto(restarConSigno(cs("-99999999999999.9998"), cs("0.0001")))).toBe(MINIMO);
    expect(texto(restarConSigno(cs(MINIMO), cs("0.0001")))).toBe("error FUERA_DE_RANGO");
    expect(texto(restarConSigno(cs("99999999999999.9998"), cs("-0.0001")))).toBe(MAXIMO);
    expect(texto(restarConSigno(cs(MAXIMO), cs("-0.0001")))).toBe("error FUERA_DE_RANGO");
    expect(texto(restarConSigno(cs(MAXIMO), cs(MINIMO)))).toBe("error FUERA_DE_RANGO");
  });

  it("sumar los dos extremos da cero, y el desborde no es una excepción", () => {
    expect(texto(sumarConSigno(cs(MAXIMO), cs(MINIMO)))).toBe("0.0000");
    expect(() => sumarConSigno(cs(MAXIMO), cs(MAXIMO))).not.toThrow();
    expect(() => restarConSigno(cs(MINIMO), cs(MAXIMO))).not.toThrow();
  });
});

describe("compararConSigno", () => {
  it("ordena con signo", () => {
    expect(compararConSigno(cs("-1"), cs("1"))).toBe(-1);
    expect(compararConSigno(cs("1"), cs("-1"))).toBe(1);
    expect(compararConSigno(cs("-2"), cs("-1"))).toBe(-1);
    expect(compararConSigno(cs("-1"), cs("-2"))).toBe(1);
    expect(compararConSigno(cs("0.0001"), cs("0.0002"))).toBe(-1);
    expect(compararConSigno(cs("0.0002"), cs("0.0001"))).toBe(1);
    expect(compararConSigno(cs("-1.5"), cs("-1.5"))).toBe(0);
    expect(compararConSigno(cs("0"), cs("0.0000"))).toBe(0);
  });
});

describe("negarConSigno y valorAbsolutoDe", () => {
  it("niegan y dan el módulo, también en los extremos", () => {
    expect(cantidadConSignoATexto(negarConSigno(cs("2.5")))).toBe("-2.5000");
    expect(cantidadConSignoATexto(negarConSigno(cs("-2.5")))).toBe("2.5000");
    expect(cantidadConSignoATexto(negarConSigno(cs("0")))).toBe("0.0000");
    expect(cantidadConSignoATexto(negarConSigno(cs(MAXIMO)))).toBe(MINIMO);
    expect(cantidadConSignoATexto(negarConSigno(cs(MINIMO)))).toBe(MAXIMO);
    expect(cantidadATexto(valorAbsolutoDe(cs("2.5")))).toBe("2.5000");
    expect(cantidadATexto(valorAbsolutoDe(cs("-2.5")))).toBe("2.5000");
    expect(cantidadATexto(valorAbsolutoDe(cs("0")))).toBe("0.0000");
    expect(cantidadATexto(valorAbsolutoDe(cs(MINIMO)))).toBe(MAXIMO);
  });
});

describe("cantidadConSignoDesdeCantidad", () => {
  it("mantiene el valor", () => {
    expect(cantidadConSignoATexto(cantidadConSignoDesdeCantidad(cantidadDesdeTexto("7.25")))).toBe(
      "7.2500",
    );
    expect(cantidadConSignoATexto(cantidadConSignoDesdeCantidad(cantidadDesdeTexto(MAXIMO)))).toBe(
      MAXIMO,
    );
  });
});

describe("multiplicarCantidades", () => {
  const c = cantidadDesdeTexto;
  const por = (a: string, b: string, politica: "MITAD_SUBE_SIMETRICA" | "MITAD_PAR") =>
    cantidadATexto(multiplicarCantidades(c(a), c(b), politica));

  it("0,5 × 0,0185 = 0,00925 → 0,0093 (la mitad sube)", () => {
    expect(por("0.5", "0.0185", "MITAD_SUBE_SIMETRICA")).toBe("0.0093");
  });

  it("el caso del spec: café con leche × 40 = 720 g con 18 g por unidad", () => {
    expect(por("40", "18", "MITAD_SUBE_SIMETRICA")).toBe("720.0000");
    expect(por("10", "50", "MITAD_SUBE_SIMETRICA")).toBe("500.0000");
  });

  it("es exacta cuando el producto entra en 4 decimales", () => {
    expect(por("1.5", "2.5", "MITAD_SUBE_SIMETRICA")).toBe("3.7500");
    expect(por("0.0001", "10000", "MITAD_SUBE_SIMETRICA")).toBe("1.0000");
    expect(por("0.1", "0.1", "MITAD_SUBE_SIMETRICA")).toBe("0.0100");
    expect(por("123.4567", "1", "MITAD_SUBE_SIMETRICA")).toBe("123.4567");
  });

  it("por cero y por uno", () => {
    expect(por("0", "99999999999999.9999", "MITAD_SUBE_SIMETRICA")).toBe("0.0000");
    expect(por("1", "99999999999999.9999", "MITAD_SUBE_SIMETRICA")).toBe(MAXIMO);
  });

  it("redondea al más cercano: por debajo de la mitad baja, por encima sube", () => {
    // 0,0001 × 0,4999 = 0,00000 4999 → 0,0000 ; 0,0001 × 0,5001 → 0,0001
    expect(por("0.4999", "0.0001", "MITAD_SUBE_SIMETRICA")).toBe("0.0000");
    expect(por("0.5001", "0.0001", "MITAD_SUBE_SIMETRICA")).toBe("0.0001");
    expect(por("0.4999", "0.0001", "MITAD_PAR")).toBe("0.0000");
    expect(por("0.5001", "0.0001", "MITAD_PAR")).toBe("0.0001");
  });

  it("la mitad sube con MITAD_SUBE_SIMETRICA, sea par o impar el dígito anterior", () => {
    // 0,5 × 0,0001 = 0,00005 → 0,0001 ; 1,5 × 0,0001 = 0,00015 → 0,0002 ; 2,5 × 0,0001 → 0,0003
    expect(por("0.5", "0.0001", "MITAD_SUBE_SIMETRICA")).toBe("0.0001");
    expect(por("1.5", "0.0001", "MITAD_SUBE_SIMETRICA")).toBe("0.0002");
    expect(por("2.5", "0.0001", "MITAD_SUBE_SIMETRICA")).toBe("0.0003");
  });

  it("la mitad va al par con MITAD_PAR", () => {
    expect(por("0.5", "0.0001", "MITAD_PAR")).toBe("0.0000");
    expect(por("1.5", "0.0001", "MITAD_PAR")).toBe("0.0002");
    expect(por("2.5", "0.0001", "MITAD_PAR")).toBe("0.0002");
    expect(por("3.5", "0.0001", "MITAD_PAR")).toBe("0.0004");
    expect(por("0.5", "0.0185", "MITAD_PAR")).toBe("0.0092");
  });

  it("un producto fuera de rango se rechaza con FUERA_DE_RANGO, no se satura", () => {
    expect(codigoDe(() => por("10000000", "10000000", "MITAD_SUBE_SIMETRICA"))).toBe(
      "FUERA_DE_RANGO",
    );
    expect(codigoDe(() => por("99999999999999.9999", "1.0001", "MITAD_SUBE_SIMETRICA"))).toBe(
      "FUERA_DE_RANGO",
    );
    expect(codigoDe(() => por("99999999999999.9999", "1.0000", "MITAD_SUBE_SIMETRICA"))).toBe(
      undefined,
    );
  });
});
