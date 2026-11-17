import { describe, expect, it } from "vitest";
import {
  camposDeHuellaDeCorreccion,
  cantidadConsumida,
  esElMismoPrecio,
  leerCorreccion,
} from "./correccion";

const CLAVE = "6f1c2a3e-8b4d-4c5e-9a7f-0d1e2f3a4b5c";
const RECEPCION = "7a2d3b4f-9c5e-4d6f-8b80-1e2f3a4b5c6d";
const valido = {
  clave: CLAVE,
  recepcionId: RECEPCION,
  linea: 1,
  correccionesVistas: 0,
  precio: "1200",
  motivo: "  El proveedor cobró 1200 ",
};

describe("leerCorreccion", () => {
  it("lee el pedido: el precio en su forma canónica (6 decimales) y el motivo sin espacios", () => {
    expect(leerCorreccion(valido)).toEqual({
      ok: true,
      valor: {
        clave: CLAVE,
        recepcionId: RECEPCION,
        linea: 1,
        correccionesVistas: 0,
        precio: "1200.000000",
        motivo: "El proveedor cobró 1200",
      },
    });
    expect(leerCorreccion({ ...valido, precio: "2.5" })).toMatchObject({
      ok: true,
      valor: { precio: "2.500000" },
    });
  });
  it("las puntas válidas: línea 1 y 9999, vistas 0 y 1 000 000", () => {
    expect(leerCorreccion({ ...valido, linea: 9999 }).ok).toBe(true);
    expect(leerCorreccion({ ...valido, correccionesVistas: 1_000_000 }).ok).toBe(true);
  });
  it("lo que no tiene la forma declarada es inválido, con su error y en el orden del pedido", () => {
    const error = (cambio: Record<string, unknown>) => {
      const r = leerCorreccion({ ...valido, ...cambio });
      return r.ok ? null : r.error;
    };
    expect(error({ clave: "no" })).toBe("IDENTIFICADOR_INVALIDO");
    expect(error({ clave: 7 })).toBe("IDENTIFICADOR_INVALIDO");
    expect(error({ clave: { toString: () => CLAVE } })).toBe("IDENTIFICADOR_INVALIDO");
    expect(error({ recepcionId: "no" })).toBe("IDENTIFICADOR_INVALIDO");
    expect(error({ recepcionId: { toString: () => RECEPCION } })).toBe("IDENTIFICADOR_INVALIDO");
    for (const linea of [0, -1, 10_000, 1.5, "1", null, Number.NaN, Infinity]) {
      expect(error({ linea })).toBe("LINEA_NO_ENCONTRADA");
    }
    for (const vistas of [-1, 1_000_001, 0.5, "0", null, Number.NaN]) {
      expect(error({ correccionesVistas: vistas })).toBe("CORRECCION_DESACTUALIZADA");
    }
    for (const precio of [
      "0",
      "-1",
      "abc",
      "",
      1200,
      null,
      "1e3",
      "1.1234567",
      { toString: () => "5" },
    ]) {
      expect(error({ precio })).toBe("PRECIO_INVALIDO");
    }
    for (const motivo of ["", "   ", 7, null, "x".repeat(501)]) {
      expect(error({ motivo })).toBe("MOTIVO_REQUERIDO");
    }
    // El orden: lo primero que falla manda.
    expect(error({ clave: "no", linea: 0, precio: "0", motivo: "" })).toBe(
      "IDENTIFICADOR_INVALIDO",
    );
    expect(error({ linea: 0, correccionesVistas: -1, precio: "0", motivo: "" })).toBe(
      "LINEA_NO_ENCONTRADA",
    );
    expect(error({ correccionesVistas: -1, precio: "0", motivo: "" })).toBe(
      "CORRECCION_DESACTUALIZADA",
    );
    expect(error({ precio: "0", motivo: "" })).toBe("PRECIO_INVALIDO");
  });
  it("algo que no es un objeto es inválido", () => {
    for (const malo of [null, undefined, "texto", 7, [], [valido]]) {
      expect(leerCorreccion(malo)).toEqual({ ok: false, error: "IDENTIFICADOR_INVALIDO" });
    }
  });
});

describe("la huella y el precio vigente", () => {
  it("los campos de la huella, en orden, con el precio canónico", () => {
    const pedido = leerCorreccion(valido);
    if (!pedido.ok) throw new Error("el pedido válido no se leyó");
    expect(camposDeHuellaDeCorreccion(pedido.valor)).toEqual([
      RECEPCION,
      1,
      0,
      "1200.000000",
      "El proveedor cobró 1200",
    ]);
  });
  it("el mismo precio se compara por valor, no por texto; sin precio vigente nada es «el mismo»", () => {
    expect(esElMismoPrecio("1000.000000", "1000.000000")).toBe(true);
    expect(esElMismoPrecio("1000.000000", "1000")).toBe(true);
    expect(esElMismoPrecio("1000.000000", "1000.000001")).toBe(false);
    expect(esElMismoPrecio(null, "1000")).toBe(false);
  });
});

describe("cantidadConsumida", () => {
  it("lo que entró menos lo que queda, en 4 decimales", () => {
    expect(cantidadConsumida("2000.0000", "500.0000")).toBe("1500.0000");
    expect(cantidadConsumida("2000.0000", "2000.0000")).toBe("0.0000");
    expect(cantidadConsumida("0.0001", "0.0001")).toBe("0.0000");
    // Se consumió todo: lo que queda es cero y lo consumido es todo lo que entró.
    expect(cantidadConsumida("2000.0000", "0.0000")).toBe("2000.0000");
  });
  it("lanza si las cantidades guardadas no son consistentes (un defecto, no un dato)", () => {
    expect(() => cantidadConsumida("5", "6")).toThrow(
      "compras: las cantidades de la corrección no son consistentes",
    );
    expect(() => cantidadConsumida("0", "0")).toThrow(RangeError);
    expect(() => cantidadConsumida("5", "-1")).toThrow(RangeError);
    expect(() => cantidadConsumida("abc", "1")).toThrow(RangeError);
    expect(() => cantidadConsumida("1", "abc")).toThrow(RangeError);
  });
});
