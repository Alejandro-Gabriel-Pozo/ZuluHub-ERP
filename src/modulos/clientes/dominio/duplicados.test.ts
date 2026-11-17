import { describe, expect, it } from "vitest";
import { digitosDeTelefono, razonesDeDuplicado, type DatosParaDuplicados } from "./duplicados";

const base: DatosParaDuplicados = {
  email: "a@b.com",
  telefono: "+54 11 4321-0000",
  nombreCompleto: "Pérez Juan",
};

describe("digitosDeTelefono", () => {
  it("deja solo los dígitos", () => {
    expect(digitosDeTelefono("+54 (11) 4321-0000")).toBe("541143210000");
    expect(digitosDeTelefono("0123456789")).toBe("0123456789");
  });
  it("sin teléfono o sin dígitos es null", () => {
    expect(digitosDeTelefono(null)).toBeNull();
    expect(digitosDeTelefono("")).toBeNull();
    expect(digitosDeTelefono("abc /-")).toBeNull();
  });
});

describe("razonesDeDuplicado", () => {
  it("mismo email, mismo teléfono por sus dígitos y mismo nombre sin tildes ni mayúsculas", () => {
    expect(
      razonesDeDuplicado(base, {
        email: "a@b.com",
        telefono: "541143210000",
        nombreCompleto: "PEREZ JUAN",
      }),
    ).toEqual(["EMAIL", "TELEFONO", "NOMBRE"]);
  });

  it("cada razón por separado", () => {
    expect(
      razonesDeDuplicado(base, { email: "a@b.com", telefono: "1", nombreCompleto: "Otro" }),
    ).toEqual(["EMAIL"]);
    expect(
      razonesDeDuplicado(base, { email: null, telefono: "541143210000", nombreCompleto: "Otro" }),
    ).toEqual(["TELEFONO"]);
    expect(
      razonesDeDuplicado(base, { email: null, telefono: null, nombreCompleto: "perez juan" }),
    ).toEqual(["NOMBRE"]);
  });

  it("nada en común no es duplicado", () => {
    expect(
      razonesDeDuplicado(base, {
        email: "x@y.com",
        telefono: "999999",
        nombreCompleto: "López Ana",
      }),
    ).toEqual([]);
  });

  it("lo ausente no coincide con lo ausente", () => {
    const vacia: DatosParaDuplicados = { email: null, telefono: null, nombreCompleto: "" };
    expect(razonesDeDuplicado(vacia, vacia)).toEqual([]);
    expect(
      razonesDeDuplicado({ ...vacia, telefono: "---" }, { ...vacia, telefono: "///" }),
    ).toEqual([]);
  });
});
