import { describe, expect, it } from "vitest";
import { cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import { importeATexto, importeDesdeTexto } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import { precioUnitarioDesdeTexto } from "../../../primitivas/dinero/precio-unitario";
import { POLITICA_VIGENTE } from "../../../primitivas/dinero/redondeo";
import { EMISOR_1, EMISOR_2, EMISOR_3 } from "../../../../test/utilidades/fiscal";
import type { LineaDeComprobante } from "./comprobante";
import { puntoDeVentaId } from "./identificadores";
import {
  calcularComprobantesDeVenta,
  planificarComprobantes,
  repartirCobro,
  totalDeLaVenta,
  type LineaDeVenta,
} from "./plan-de-comprobantes";

const PV_1 = puntoDeVentaId("pv-1");
const PV_2 = puntoDeVentaId("pv-2");
const PV_3 = puntoDeVentaId("pv-3");
const delEmisor1 = { id: PV_1, emisorId: EMISOR_1 };
const delEmisor2 = { id: PV_2, emisorId: EMISOR_2 };
const otroDelEmisor1 = { id: PV_3, emisorId: EMISOR_1 };

const lineas = (...emisores: [number, typeof EMISOR_1][]): LineaDeVenta[] =>
  emisores.map(([posicion, emisorId]) => ({ posicion, emisorId }));

describe("planificarComprobantes", () => {
  it("una venta sin líneas no genera comprobantes", () => {
    expect(planificarComprobantes([], [delEmisor1], null)).toEqual({ ok: true, valor: [] });
  });

  it("un solo emisor: un comprobante con todas las líneas ordenadas", () => {
    expect(
      planificarComprobantes(
        lineas([3, EMISOR_1], [1, EMISOR_1], [2, EMISOR_1]),
        [delEmisor1],
        null,
      ),
    ).toEqual({
      ok: true,
      valor: [{ emisorId: EMISOR_1, puntoDeVentaId: PV_1, posiciones: [1, 2, 3] }],
    });
  });

  it("dos emisores: un comprobante por emisor, ordenados por la primera posición de cada uno", () => {
    const r = planificarComprobantes(
      lineas([1, EMISOR_2], [2, EMISOR_1], [3, EMISOR_2], [4, EMISOR_1]),
      [delEmisor1, delEmisor2],
      null,
    );
    expect(r).toEqual({
      ok: true,
      valor: [
        { emisorId: EMISOR_2, puntoDeVentaId: PV_2, posiciones: [1, 3] },
        { emisorId: EMISOR_1, puntoDeVentaId: PV_1, posiciones: [2, 4] },
      ],
    });
  });

  it("el orden no depende del orden de las líneas de entrada", () => {
    const a = planificarComprobantes(
      lineas([4, EMISOR_1], [3, EMISOR_2], [2, EMISOR_1], [1, EMISOR_2]),
      [delEmisor1, delEmisor2],
      null,
    );
    expect(a).toEqual({
      ok: true,
      valor: [
        { emisorId: EMISOR_2, puntoDeVentaId: PV_2, posiciones: [1, 3] },
        { emisorId: EMISOR_1, puntoDeVentaId: PV_1, posiciones: [2, 4] },
      ],
    });
  });

  it("el orden es por la primera POSICIÓN, no por el orden de aparición ni por el tamaño", () => {
    // El emisor 1 aparece primero en la lista pero su primera posición es mayor.
    const r = planificarComprobantes(
      lineas([10, EMISOR_1], [11, EMISOR_1], [12, EMISOR_1], [2, EMISOR_2]),
      [delEmisor1, delEmisor2],
      null,
    );
    expect(r.ok && r.valor.map((p) => p.emisorId)).toEqual([EMISOR_2, EMISOR_1]);
  });

  it("con varios habilitados, el punto de venta elegido es el del emisor elegido", () => {
    const r = planificarComprobantes(
      lineas([1, EMISOR_1]),
      [delEmisor1, otroDelEmisor1, delEmisor2],
      PV_3,
    );
    expect(r).toEqual({
      ok: true,
      valor: [{ emisorId: EMISOR_1, puntoDeVentaId: PV_3, posiciones: [1] }],
    });
  });

  it("el elegido es de un emisor: el otro emisor usa su único habilitado", () => {
    const r = planificarComprobantes(
      lineas([1, EMISOR_1], [2, EMISOR_2]),
      [delEmisor1, delEmisor2],
      PV_1,
    );
    expect(r).toEqual({
      ok: true,
      valor: [
        { emisorId: EMISOR_1, puntoDeVentaId: PV_1, posiciones: [1] },
        { emisorId: EMISOR_2, puntoDeVentaId: PV_2, posiciones: [2] },
      ],
    });
  });

  it("el elegido de otro emisor no se usa para este", () => {
    const r = planificarComprobantes(lineas([1, EMISOR_1]), [delEmisor1, delEmisor2], PV_2);
    expect(r).toEqual({
      ok: true,
      valor: [{ emisorId: EMISOR_1, puntoDeVentaId: PV_1, posiciones: [1] }],
    });
  });

  it("un emisor sin punto de venta habilitado: SIN_PUNTO_DE_VENTA_PARA_EMISOR", () => {
    expect(planificarComprobantes(lineas([1, EMISOR_3]), [delEmisor1, delEmisor2], null)).toEqual({
      ok: false,
      error: "SIN_PUNTO_DE_VENTA_PARA_EMISOR",
    });
    expect(planificarComprobantes(lineas([1, EMISOR_1]), [], null)).toEqual({
      ok: false,
      error: "SIN_PUNTO_DE_VENTA_PARA_EMISOR",
    });
  });

  it("varios habilitados del emisor y ninguno elegido: PUNTO_DE_VENTA_AMBIGUO", () => {
    expect(
      planificarComprobantes(lineas([1, EMISOR_1]), [delEmisor1, otroDelEmisor1], null),
    ).toEqual({ ok: false, error: "PUNTO_DE_VENTA_AMBIGUO" });
  });

  it("el ambiguo de un emisor no se resuelve con el elegido de otro", () => {
    expect(
      planificarComprobantes(lineas([1, EMISOR_1]), [delEmisor1, otroDelEmisor1, delEmisor2], PV_2),
    ).toEqual({ ok: false, error: "PUNTO_DE_VENTA_AMBIGUO" });
  });

  it("un punto de venta repetido en la lista de habilitados no lo vuelve ambiguo", () => {
    const r = planificarComprobantes(lineas([1, EMISOR_1]), [delEmisor1, delEmisor1], null);
    expect(r).toEqual({
      ok: true,
      valor: [{ emisorId: EMISOR_1, puntoDeVentaId: PV_1, posiciones: [1] }],
    });
  });

  it("un punto de venta elegido que no está habilitado se rechaza (no se cambia en silencio)", () => {
    expect(planificarComprobantes(lineas([1, EMISOR_1]), [delEmisor1], PV_3)).toEqual({
      ok: false,
      error: "PUNTO_DE_VENTA_ELEGIDO_NO_HABILITADO",
    });
    expect(planificarComprobantes([], [delEmisor1], PV_3)).toEqual({
      ok: false,
      error: "PUNTO_DE_VENTA_ELEGIDO_NO_HABILITADO",
    });
  });

  it("el error del primer plan, en orden, es el que se informa", () => {
    // Emisor 2 (primero por posición) no tiene punto de venta; el emisor 1 sería ambiguo.
    expect(
      planificarComprobantes(
        lineas([1, EMISOR_2], [2, EMISOR_1]),
        [delEmisor1, otroDelEmisor1],
        null,
      ),
    ).toEqual({ ok: false, error: "SIN_PUNTO_DE_VENTA_PARA_EMISOR" });
    expect(
      planificarComprobantes(
        lineas([1, EMISOR_1], [2, EMISOR_2]),
        [delEmisor1, otroDelEmisor1],
        null,
      ),
    ).toEqual({ ok: false, error: "PUNTO_DE_VENTA_AMBIGUO" });
  });

  it("una posición repetida es un error de programación", () => {
    expect(() =>
      planificarComprobantes(lineas([1, EMISOR_1], [1, EMISOR_2]), [delEmisor1, delEmisor2], null),
    ).toThrow(new RangeError("hay posiciones de línea repetidas"));
  });

  it("no modifica sus entradas", () => {
    const entrada = lineas([2, EMISOR_1], [1, EMISOR_1]);
    const copia = structuredClone(entrada);
    planificarComprobantes(entrada, [delEmisor1], null);
    expect(entrada).toEqual(copia);
  });
});

function lineaDeComprobante(precio: string, cantidad: string): LineaDeComprobante {
  return {
    precioUnitario: precioUnitarioDesdeTexto(precio),
    cantidad: cantidadDesdeTexto(cantidad),
    alicuota: "21",
  };
}

describe("venta mixta: cada comprobante se redondea por separado", () => {
  // Tres líneas de 3 × 9,95 con 21 %: ejemplo con empates de redondeo.
  const todas = [
    { posicion: 1, emisorId: EMISOR_1, linea: lineaDeComprobante("9.95", "3") },
    { posicion: 2, emisorId: EMISOR_2, linea: lineaDeComprobante("0.005", "1") },
    { posicion: 3, emisorId: EMISOR_1, linea: lineaDeComprobante("0.005", "1") },
    { posicion: 4, emisorId: EMISOR_2, linea: lineaDeComprobante("0.005", "1") },
  ];
  const plan = planificarComprobantes(todas, [delEmisor1, delEmisor2], null);

  it("calcula un comprobante por plan, con las líneas de ese plan", () => {
    if (!plan.ok) throw new Error("plan inválido");
    const calculados = calcularComprobantesDeVenta(ARS, todas, plan.valor, POLITICA_VIGENTE);
    expect(calculados.map((c) => c.plan.emisorId)).toEqual([EMISOR_1, EMISOR_2]);
    expect(calculados.map((c) => c.calculado.lineas.length)).toEqual([2, 2]);
    // El emisor 1 suma 29,85 + 0,005 = 29,855 → 29,86; el emisor 2 suma 0,01 → 0,01.
    expect(calculados.map((c) => importeATexto(c.calculado.total))).toEqual(["29.86", "0.01"]);
  });

  it("el total de la venta es la suma de los totales por comprobante (no se redondea junto)", () => {
    if (!plan.ok) throw new Error("plan inválido");
    const calculados = calcularComprobantesDeVenta(ARS, todas, plan.valor, POLITICA_VIGENTE);
    expect(importeATexto(totalDeLaVenta(ARS, calculados))).toBe("29.87");
    expect(importeATexto(totalDeLaVenta(ARS, []))).toBe("0.00");
  });

  it("una línea del plan que falta es un error de programación", () => {
    if (!plan.ok) throw new Error("plan inválido");
    expect(() =>
      calcularComprobantesDeVenta(ARS, todas.slice(1), plan.valor, POLITICA_VIGENTE),
    ).toThrow(new RangeError("falta la línea de la posición 1"));
  });
});

describe("repartirCobro", () => {
  const importe = (t: string) => importeDesdeTexto(ARS, t);

  it("reparte en proporción a los totales y suma exacto", () => {
    const partes = repartirCobro(importe("100.00"), [importe("29.86"), importe("0.01")]);
    expect(partes.map(importeATexto)).toEqual(["99.97", "0.03"]);
  });

  it("un solo comprobante recibe todo el cobro", () => {
    expect(repartirCobro(importe("10.00"), [importe("7.00")]).map(importeATexto)).toEqual([
      "10.00",
    ]);
  });

  it("con totales iguales y un resto, el primero se lleva el centavo", () => {
    expect(
      repartirCobro(importe("0.01"), [importe("1.00"), importe("1.00")]).map(importeATexto),
    ).toEqual(["0.01", "0.00"]);
  });

  it("sin nada que cobrar, todo cero", () => {
    expect(
      repartirCobro(importe("0.00"), [importe("1.00"), importe("2.00")]).map(importeATexto),
    ).toEqual(["0.00", "0.00"]);
  });

  it("no se puede repartir un cobro entre totales en cero", () => {
    expect(() => repartirCobro(importe("1.00"), [importe("0.00")])).toThrow();
  });
});
