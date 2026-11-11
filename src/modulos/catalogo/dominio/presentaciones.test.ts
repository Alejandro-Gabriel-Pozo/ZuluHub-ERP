import { describe, expect, it } from "vitest";
import { datosDePresentacion, nombreDePresentacionDesdeTexto } from "./presentaciones";

describe("datosDePresentacion", () => {
  it("normaliza el nombre (clave en minúsculas) y la cantidad a 4 decimales", () => {
    const r = datosDePresentacion({ nombre: "Caja x 12", cantidad: "12", dePesoVariable: false });
    expect(r).toEqual({
      ok: true,
      valor: {
        nombre: "Caja x 12",
        nombreClave: "caja x 12",
        cantidad: "12.0000",
        dePesoVariable: false,
      },
    });
  });

  it("conserva el peso variable y la cantidad aproximada", () => {
    const r = datosDePresentacion({ nombre: "Pieza", cantidad: "4000.5", dePesoVariable: true });
    expect(r.ok && r.valor.dePesoVariable).toBe(true);
    expect(r.ok && r.valor.cantidad).toBe("4000.5000");
  });

  it("rechaza un nombre vacío, sin letras, con control o de más de 80 caracteres; acepta uno de exactamente 80", () => {
    for (const nombre of ["", "   ", "123", "Caja\n12", "a".repeat(81)]) {
      expect(datosDePresentacion({ nombre, cantidad: "1", dePesoVariable: false })).toEqual({
        ok: false,
        error: "NOMBRE_INVALIDO",
      });
    }
    expect(nombreDePresentacionDesdeTexto("a".repeat(80)).ok).toBe(true);
  });

  it("rechaza una cantidad cero, negativa, con más de 4 decimales, no numérica o fuera de rango", () => {
    for (const cantidad of ["0", "-1", "1.00001", "abc", "", "1e3", "100000000000000"]) {
      expect(datosDePresentacion({ nombre: "Caja", cantidad, dePesoVariable: false })).toEqual({
        ok: false,
        error: "CANTIDAD_INVALIDA",
      });
    }
  });

  it("el nombre se valida antes que la cantidad", () => {
    expect(datosDePresentacion({ nombre: "", cantidad: "0", dePesoVariable: false })).toEqual({
      ok: false,
      error: "NOMBRE_INVALIDO",
    });
  });

  it("Café y CAFÉ tienen la misma clave", () => {
    const a = nombreDePresentacionDesdeTexto("Café");
    const b = nombreDePresentacionDesdeTexto("CAFÉ");
    expect(a.ok && b.ok && a.valor.nombreClave === b.valor.nombreClave).toBe(true);
  });
});
