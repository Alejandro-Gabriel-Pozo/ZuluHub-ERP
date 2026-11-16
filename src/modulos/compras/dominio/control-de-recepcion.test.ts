import { describe, expect, it } from "vitest";
import {
  CONDICIONES_DE_LINEA,
  LARGO_MAXIMO_DE_LA_OBSERVACION_DE_RECEPCION,
  leerControlDeLinea,
  leerControles,
} from "./control-de-recepcion";

const conforme = { linea: 1, condicion: "CONFORME" };

describe("leerControlDeLinea", () => {
  it("una línea conforme no pide observación y deja vacío lo que no se cargó", () => {
    expect(leerControlDeLinea(conforme)).toEqual({
      ok: true,
      valor: {
        linea: 1,
        cantidadSegunRemito: null,
        condicion: "CONFORME",
        observacion: null,
        temperaturaEnC: null,
      },
    });
  });

  it("acepta las tres condiciones y rechaza cualquier otra, incluidas las que no son texto", () => {
    for (const condicion of CONDICIONES_DE_LINEA) {
      expect(leerControlDeLinea({ ...conforme, condicion, observacion: "Caja golpeada" }).ok).toBe(
        true,
      );
    }
    for (const condicion of ["conforme", "OK", "", undefined, null, 1, {}]) {
      expect(leerControlDeLinea({ ...conforme, condicion })).toEqual({
        ok: false,
        error: "CONDICION_INVALIDA",
      });
    }
  });

  it("sin observación solo pasa CONFORME; la observación en blanco o con signos prohibidos no cuenta", () => {
    for (const condicion of ["CON_OBSERVACIONES", "RECHAZADA"]) {
      expect(leerControlDeLinea({ ...conforme, condicion })).toEqual({
        ok: false,
        error: "OBSERVACION_REQUERIDA",
      });
      expect(leerControlDeLinea({ ...conforme, condicion, observacion: null })).toEqual({
        ok: false,
        error: "OBSERVACION_REQUERIDA",
      });
      expect(leerControlDeLinea({ ...conforme, condicion, observacion: "   " })).toEqual({
        ok: false,
        error: "OBSERVACION_INVALIDA",
      });
    }
    for (const observacion of [
      "<b>",
      "línea\ndos",
      5,
      "x".repeat(LARGO_MAXIMO_DE_LA_OBSERVACION_DE_RECEPCION + 1),
    ]) {
      expect(leerControlDeLinea({ ...conforme, observacion })).toEqual({
        ok: false,
        error: "OBSERVACION_INVALIDA",
      });
    }
    const justa = "a".repeat(LARGO_MAXIMO_DE_LA_OBSERVACION_DE_RECEPCION);
    expect(leerControlDeLinea({ ...conforme, condicion: "RECHAZADA", observacion: justa }).ok).toBe(
      true,
    );
  });

  it("la temperatura: hasta un decimal, entre el cero absoluto y mil grados, en forma canónica", () => {
    const leer = (temperaturaEnC: unknown) => leerControlDeLinea({ ...conforme, temperaturaEnC });
    const valido = (texto: string) => {
      const r = leer(texto);
      return r.ok ? r.valor.temperaturaEnC : r.error;
    };
    expect(valido("4")).toBe("4");
    expect(valido("4.0")).toBe("4");
    expect(valido("-18.5")).toBe("-18.5");
    expect(valido("-0")).toBe("0");
    expect(valido("-0.0")).toBe("0");
    expect(valido("0")).toBe("0");
    expect(valido("999.9")).toBe("999.9");
    expect(valido("-273.1")).toBe("-273.1");
    for (const mala of [
      "-273.2",
      "-273.15",
      "-999.9",
      "1000",
      "04",
      "4.25",
      "4.",
      ".5",
      "+4",
      "1e2",
      " 4",
      "",
      "NaN",
      "abc",
    ]) {
      expect(leer(mala), mala).toEqual({ ok: false, error: "TEMPERATURA_INVALIDA" });
    }
    for (const mala of [4, true, {}, []]) {
      expect(leer(mala)).toEqual({ ok: false, error: "TEMPERATURA_INVALIDA" });
    }
    expect(leer(null).ok).toBe(true);
    expect(leer(undefined).ok).toBe(true);
  });

  it("la cantidad según remito: decimal canónico mayor que cero, de hasta cuatro decimales", () => {
    const leer = (cantidadSegunRemito: unknown) =>
      leerControlDeLinea({ ...conforme, cantidadSegunRemito });
    const r = leer("2.5");
    expect(r.ok && r.valor.cantidadSegunRemito).toBe("2.5000");
    for (const mala of ["0", "-1", "1.00001", "abc", "", 3, {}]) {
      expect(leer(mala), JSON.stringify(mala)).toEqual({
        ok: false,
        error: "CANTIDAD_SEGUN_REMITO_INVALIDA",
      });
    }
    expect(leer(null).ok).toBe(true);
  });

  it("la línea es un entero de 1 al máximo de renglones de una compra", () => {
    for (const linea of [0, -1, 1.5, "1", null, undefined, 10_000]) {
      expect(leerControlDeLinea({ ...conforme, linea })).toEqual({
        ok: false,
        error: "LINEA_NO_ENCONTRADA",
      });
    }
    expect(leerControlDeLinea({ ...conforme, linea: 9_999 }).ok).toBe(true);
  });

  it("lo que no es un objeto no es un control", () => {
    for (const crudo of [null, undefined, "x", 1, [], [conforme]]) {
      expect(leerControlDeLinea(crudo)).toEqual({ ok: false, error: "CONTROL_INVALIDO" });
    }
  });
});

describe("leerControles", () => {
  it("lee varios controles, de líneas que existen y sin repetir", () => {
    const r = leerControles(
      [conforme, { linea: 2, condicion: "RECHAZADA", observacion: "Vencida" }],
      2,
    );
    expect(r.ok && r.valor.map((c) => c.linea)).toEqual([1, 2]);
    expect(leerControles([], 3)).toEqual({ ok: true, valor: [] });
  });

  it("rechaza la línea repetida, la que la recepción no tiene y lo que no es una lista", () => {
    expect(leerControles([conforme, conforme], 2)).toEqual({ ok: false, error: "LINEA_REPETIDA" });
    expect(leerControles([{ ...conforme, linea: 3 }], 2)).toEqual({
      ok: false,
      error: "LINEA_NO_ENCONTRADA",
    });
    expect(leerControles([{ ...conforme, linea: 2 }], 2).ok).toBe(true);
    for (const crudo of [null, undefined, {}, "x"]) {
      expect(leerControles(crudo, 2)).toEqual({ ok: false, error: "CONTROL_INVALIDO" });
    }
  });

  it("el primer error del pedido es el que se informa", () => {
    expect(
      leerControles(
        [
          { linea: 1, condicion: "X" },
          { linea: 1, condicion: "CONFORME" },
        ],
        1,
      ),
    ).toEqual({
      ok: false,
      error: "CONDICION_INVALIDA",
    });
  });
});
