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
        cantidad: null,
        pesoReal: null,
        precioPor: null,
        unidadDePrecio: null,
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

describe("leerCorreccion: cantidad, peso real y «precio por» (ampliada, 15/11/2026)", () => {
  const sinPrecio = {
    clave: CLAVE,
    recepcionId: RECEPCION,
    linea: 1,
    correccionesVistas: 0,
    motivo: "Se contó mal",
  };
  const leer = (cambio: Record<string, unknown>) => leerCorreccion({ ...sinPrecio, ...cambio });
  const error = (cambio: Record<string, unknown>) => {
    const r = leer(cambio);
    return r.ok ? null : r.error;
  };

  it("corrige solo la cantidad, solo el peso real o los tres a la vez, en su forma canónica", () => {
    expect(leer({ cantidad: "3" })).toMatchObject({
      ok: true,
      valor: { precio: null, cantidad: "3.0000", pesoReal: null },
    });
    expect(leer({ pesoReal: "2.5" })).toMatchObject({
      ok: true,
      valor: { pesoReal: "2.5000", cantidad: null },
    });
    expect(leer({ precio: "10", cantidad: "3", pesoReal: "1.2" })).toMatchObject({
      ok: true,
      valor: { precio: "10.000000", cantidad: "3.0000", pesoReal: "1.2000" },
    });
  });
  it("sin ningún cambio no hay corrección (un campo que no viene es «no cambia»); uno que viene y es inválido se rechaza, no se ignora", () => {
    expect(error({})).toBe("CORRECCION_SIN_CAMBIOS_PEDIDOS");
    expect(error({ precioPor: undefined })).toBe("CORRECCION_SIN_CAMBIOS_PEDIDOS");
    for (const cantidad of ["0", "-1", "", "abc", 3, null, "1.00001", "1e2"]) {
      expect(error({ cantidad })).toBe("CANTIDAD_INVALIDA");
    }
    for (const pesoReal of ["0", "-1", "", 2, null, "1.00001"]) {
      expect(error({ pesoReal })).toBe("PESO_REAL_INVALIDO");
    }
    expect(error({ precio: null })).toBe("PRECIO_INVALIDO");
  });
  it("el «precio por» solo acompaña a un precio: por unidad lleva su unidad, por presentación no, y cualquier otra combinación se rechaza", () => {
    expect(leer({ precio: "10", precioPor: "PRESENTACION" })).toMatchObject({
      ok: true,
      valor: { precioPor: "PRESENTACION", unidadDePrecio: null },
    });
    expect(leer({ precio: "10", precioPor: "UNIDAD", unidadDePrecio: "KILOGRAMO" })).toMatchObject({
      ok: true,
      valor: { precioPor: "UNIDAD", unidadDePrecio: "KILOGRAMO" },
    });
    for (const cambio of [
      { precioPor: "PRESENTACION" },
      { cantidad: "3", precioPor: "PRESENTACION" },
      { precio: "10", precioPor: "UNIDAD" },
      { precio: "10", precioPor: "UNIDAD", unidadDePrecio: "LITRO_QUE_NO_EXISTE" },
      { precio: "10", precioPor: "PRESENTACION", unidadDePrecio: "KILOGRAMO" },
      { precio: "10", precioPor: "OTRO" },
      { precio: "10", unidadDePrecio: "KILOGRAMO" },
      { precio: "10", precioPor: null },
    ]) {
      expect(error(cambio)).toBe("PRECIO_POR_INVALIDO");
    }
  });
  it("el orden de los errores: precio, cantidad, peso real, «precio por», al menos un cambio y motivo", () => {
    expect(error({ precio: "0", cantidad: "0", pesoReal: "0", motivo: "" })).toBe(
      "PRECIO_INVALIDO",
    );
    expect(error({ cantidad: "0", pesoReal: "0", motivo: "" })).toBe("CANTIDAD_INVALIDA");
    expect(error({ pesoReal: "0", motivo: "" })).toBe("PESO_REAL_INVALIDO");
    expect(error({ precioPor: "UNIDAD", motivo: "" })).toBe("PRECIO_POR_INVALIDO");
    expect(error({ motivo: "" })).toBe("CORRECCION_SIN_CAMBIOS_PEDIDOS");
    expect(error({ cantidad: "3", motivo: "" })).toBe("MOTIVO_REQUERIDO");
  });
  it("la huella: solo precio conserva los campos de antes de la ampliación; con otros campos, todos, y el mismo pedido da la misma huella", () => {
    const pedidoLeido = (cambio: Record<string, unknown>) => {
      const r = leer(cambio);
      if (!r.ok) throw new Error("el pedido válido no se leyó");
      return r.valor;
    };
    const pedido = (cambio: Record<string, unknown>) =>
      camposDeHuellaDeCorreccion(pedidoLeido(cambio));
    expect(pedido({ precio: "1200" })).toEqual([RECEPCION, 1, 0, "1200.000000", "Se contó mal"]);
    expect(pedido({ cantidad: "3" })).toEqual([
      RECEPCION,
      1,
      0,
      "",
      "3.0000",
      "",
      "",
      "",
      "Se contó mal",
    ]);
    expect(pedido({ precio: "10", precioPor: "UNIDAD", unidadDePrecio: "KILOGRAMO" })).toEqual([
      RECEPCION,
      1,
      0,
      "10.000000",
      "",
      "",
      "UNIDAD",
      "KILOGRAMO",
      "Se contó mal",
    ]);
    // «Solo precio» exige que ningún otro campo venga: con cantidad, con peso real o sin precio, la huella lleva todos.
    expect(pedido({ precio: "10", cantidad: "3" })).toEqual([
      RECEPCION,
      1,
      0,
      "10.000000",
      "3.0000",
      "",
      "",
      "",
      "Se contó mal",
    ]);
    expect(pedido({ precio: "10", pesoReal: "3" })).toEqual([
      RECEPCION,
      1,
      0,
      "10.000000",
      "",
      "3.0000",
      "",
      "",
      "Se contó mal",
    ]);
    const sinNada = pedidoLeido({ precio: "10" });
    expect(
      camposDeHuellaDeCorreccion({
        ...sinNada,
        precio: null,
      }),
    ).toEqual([RECEPCION, 1, 0, "", "", "", "", "", "Se contó mal"]);
    expect(pedido({ cantidad: "3" })).toEqual(pedido({ cantidad: "3.0" }));
    expect(pedido({ cantidad: "3" })).not.toEqual(pedido({ pesoReal: "3" }));
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
