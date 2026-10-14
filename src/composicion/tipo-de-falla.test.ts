import { describe, expect, it } from "vitest";
import { tipoDeFalla } from "./tipo-de-falla";

const conCodigo = (codigo: unknown, mensaje = "mensaje con clave=secreta") =>
  Object.assign(new Error(mensaje), { code: codigo });

describe("tipoDeFalla", () => {
  it("un Error cuenta su nombre y nunca su mensaje", () => {
    expect(tipoDeFalla(new RangeError("clave=secreta"))).toBe("RangeError");
  });

  it.each(["42501", "42P01", "28P01", "57P01", "XX000"])(
    "suma el código de Postgres %s si lo trae",
    (codigo) => {
      expect(tipoDeFalla(conCodigo(codigo))).toBe(`Error ${codigo}`);
    },
  );

  it.each([
    ["un código de red", "ECONNREFUSED"],
    ["un código de cuatro", "4250"],
    ["un código de seis", "425011"],
    ["un código en minúscula", "42p01"],
    ["un código con un espacio", "4250 "],
    ["un código con caracteres raros", "42-01"],
    ["un código numérico", 42501],
    ["sin código", undefined],
    ["un código nulo", null],
  ])("no suma %s", (_cual, codigo) => {
    expect(tipoDeFalla(conCodigo(codigo))).toBe("Error");
  });

  it("lo que no es un Error es un texto fijo", () => {
    for (const valor of ["texto crudo con clave", 42, null, undefined, { code: "42501" }]) {
      expect(tipoDeFalla(valor)).toBe("falla que no es un Error");
    }
  });
});
