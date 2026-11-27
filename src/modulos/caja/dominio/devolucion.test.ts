import { describe, expect, it } from "vitest";
import { importeDesdeTexto, importeATexto } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import {
  MAXIMO_DE_LINEAS_DE_UNA_DEVOLUCION,
  ORIGENES_DEVOLUBLES,
  claveDeAnulacionDeLinea,
  claveDeLinea,
  decidirDevolucion,
  devolucionIdDe,
  huellaDeLaDevolucion,
  type LineaDeDevolucion,
  validarLineasDeDevolucion,
} from "./devolucion";

const ars = (monto: string) => ({ moneda: "ARS", monto });
const imp = (monto: string) => importeDesdeTexto(ARS, monto);
const linea = (medio: string, monto: string, cuenta: string | null = null) => ({
  medioDePagoId: medio,
  cuentaDeCobroId: cuenta,
  importe: ars(monto),
});

describe("decidirDevolucion", () => {
  it("acepta de 1 a 10 líneas que no superan lo devolvible y devuelve el total exacto", () => {
    const r = decidirDevolucion({
      devolvible: imp("10000.00"),
      lineas: [linea("m1", "4000.00"), linea("m2", "6000.00", "c1")],
    });
    expect(r.ok && importeATexto(r.valor.total)).toBe("10000.00");
  });
  it("sin líneas o con más de las permitidas es LINEAS_INVALIDAS", () => {
    expect(decidirDevolucion({ devolvible: imp("100.00"), lineas: [] })).toEqual({
      ok: false,
      error: "LINEAS_INVALIDAS",
    });
    const muchas = Array.from({ length: MAXIMO_DE_LINEAS_DE_UNA_DEVOLUCION + 1 }, (_, i) =>
      linea(`m${i}`, "1.00"),
    );
    expect(decidirDevolucion({ devolvible: imp("100.00"), lineas: muchas })).toEqual({
      ok: false,
      error: "LINEAS_INVALIDAS",
    });
    expect(decidirDevolucion({ devolvible: imp("100.00"), lineas: muchas.slice(0, 10) }).ok).toBe(
      true,
    );
  });
  it("un importe cero, negativo, con tres decimales, en otra moneda o sobre el tope se rechaza", () => {
    for (const malo of ["0.00", "-1.00", "1.001", "1e3", "1000000000.00"]) {
      expect(
        decidirDevolucion({ devolvible: imp("999999999.99"), lineas: [linea("m1", malo)] }),
      ).toEqual({ ok: false, error: "IMPORTE_INVALIDO" });
    }
    expect(
      decidirDevolucion({
        devolvible: imp("100.00"),
        lineas: [
          { medioDePagoId: "m1", cuentaDeCobroId: null, importe: { moneda: "USD", monto: "1.00" } },
        ],
      }),
    ).toEqual({ ok: false, error: "MONEDA_NO_SOPORTADA" });
  });
  it("el mismo par (medio, cuenta) dos veces es LINEA_REPETIDA; el mismo medio con otra cuenta no", () => {
    expect(
      decidirDevolucion({
        devolvible: imp("100.00"),
        lineas: [linea("m1", "1.00", "c1"), linea("m1", "2.00", "c1")],
      }),
    ).toEqual({ ok: false, error: "LINEA_REPETIDA" });
    expect(
      decidirDevolucion({
        devolvible: imp("100.00"),
        lineas: [linea("m1", "1.00", "c1"), linea("m1", "2.00", "c2"), linea("m1", "3.00")],
      }).ok,
    ).toBe(true);
  });
  it("superar lo devolvible por un centavo es DEVOLUCION_SUPERA_LO_COBRADO; justo lo devolvible entra", () => {
    expect(
      decidirDevolucion({ devolvible: imp("10000.00"), lineas: [linea("m1", "10000.01")] }),
    ).toEqual({ ok: false, error: "DEVOLUCION_SUPERA_LO_COBRADO" });
    expect(
      decidirDevolucion({ devolvible: imp("10000.00"), lineas: [linea("m1", "10000.00")] }).ok,
    ).toBe(true);
    expect(decidirDevolucion({ devolvible: imp("0.00"), lineas: [linea("m1", "0.01")] })).toEqual({
      ok: false,
      error: "DEVOLUCION_SUPERA_LO_COBRADO",
    });
  });
});

describe("huella, clave de línea e id del pedido", () => {
  const lineas: LineaDeDevolucion[] = [
    { medioDePagoId: "m2", cuentaDeCobroId: "c1", importe: imp("6.00") },
    { medioDePagoId: "m1", cuentaDeCobroId: null, importe: imp("4.00") },
  ];
  const base = { cobranzaId: "cb", sesionId: "s", lineas, motivo: "Error de cobro" };
  it("el orden de las líneas no cambia la huella; cualquier otro dato sí", () => {
    const h = huellaDeLaDevolucion(base);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(huellaDeLaDevolucion({ ...base, lineas: [...lineas].reverse() })).toBe(h);
    for (const otro of [
      { cobranzaId: "cx" },
      { sesionId: "sx" },
      { motivo: "Otro" },
      { lineas: [lineas[0] as LineaDeDevolucion] },
      {
        lineas: [
          lineas[0] as LineaDeDevolucion,
          { ...(lineas[1] as LineaDeDevolucion), importe: imp("4.01") },
        ],
      },
      {
        lineas: [
          lineas[0] as LineaDeDevolucion,
          { ...(lineas[1] as LineaDeDevolucion), cuentaDeCobroId: "c9" },
        ],
      },
    ]) {
      expect(huellaDeLaDevolucion({ ...base, ...otro })).not.toBe(h);
    }
  });
  it("la clave de línea es determinística, distinta por orden y por pedido, y tiene la forma de la base", () => {
    const k = claveDeLinea("clave-del-pedido-0001", 1);
    expect(k).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    expect(claveDeLinea("clave-del-pedido-0001", 1)).toBe(k);
    expect(claveDeLinea("clave-del-pedido-0001", 2)).not.toBe(k);
    expect(claveDeLinea("clave-del-pedido-0002", 1)).not.toBe(k);
  });
  it("el id del pedido es un uuid determinístico distinto por clave", () => {
    const id = devolucionIdDe("clave-del-pedido-0001");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(devolucionIdDe("clave-del-pedido-0001")).toBe(id);
    expect(devolucionIdDe("clave-del-pedido-0002")).not.toBe(id);
  });
  it("los orígenes devolubles son solo la cobranza de ticket", () => {
    expect([...ORIGENES_DEVOLUBLES]).toEqual(["ventas.cobranza_de_ticket"]);
  });
});

describe("validarLineasDeDevolucion", () => {
  it("valida solo la forma: no mira lo devolvible, así una repetición ya hecha no falla por el tope", () => {
    const r = validarLineasDeDevolucion([linea("m1", "999999.00")]);
    expect(r.ok && importeATexto(r.valor.total)).toBe("999999.00");
  });
  it("rechaza sin líneas, con demasiadas, repetidas, en cero, en otra moneda o con tres decimales", () => {
    expect(validarLineasDeDevolucion([])).toEqual({ ok: false, error: "LINEAS_INVALIDAS" });
    expect(validarLineasDeDevolucion([linea("m1", "1.00"), linea("m1", "2.00")])).toEqual({
      ok: false,
      error: "LINEA_REPETIDA",
    });
    for (const monto of ["0.00", "10.005", "-1.00"]) {
      expect(validarLineasDeDevolucion([linea("m1", monto)]).ok, monto).toBe(false);
    }
    expect(
      validarLineasDeDevolucion([
        { ...linea("m1", "1.00"), importe: { moneda: "USD", monto: "1.00" } },
      ]).ok,
    ).toBe(false);
  });
  it("el mismo medio con otra cuenta no es una línea repetida", () => {
    expect(validarLineasDeDevolucion([linea("m1", "1.00"), linea("m1", "2.00", "c1")]).ok).toBe(
      true,
    );
  });
});

describe("claveDeAnulacionDeLinea", () => {
  it("es determinística, cambia con el pedido y con el orden, tiene la forma de las claves de la base y no choca con la de devolver", () => {
    const k = claveDeAnulacionDeLinea("clave-de-anular-0001", 1);
    expect(k).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    expect(claveDeAnulacionDeLinea("clave-de-anular-0001", 1)).toBe(k);
    expect(claveDeAnulacionDeLinea("clave-de-anular-0001", 2)).not.toBe(k);
    expect(claveDeAnulacionDeLinea("clave-de-anular-0002", 1)).not.toBe(k);
    expect(claveDeAnulacionDeLinea("clave-de-anular-0001", 1)).not.toBe(
      claveDeLinea("clave-de-anular-0001", 1),
    );
  });
});
