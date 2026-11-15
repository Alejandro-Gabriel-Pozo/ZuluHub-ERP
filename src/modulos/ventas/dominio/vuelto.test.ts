import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../../test/propiedades/configuracion";
import { MAXIMO_DE_COBROS_POR_TICKET } from "./cobranza";
import { calcularVuelto, type PagoParaVuelto } from "./vuelto";

const pago = (tipo: PagoParaVuelto["tipo"], monto: string): PagoParaVuelto => ({
  tipo,
  importe: { moneda: "ARS", monto },
});
const total = (monto: string) => ({ moneda: "ARS", monto });
const valor = (r: ReturnType<typeof calcularVuelto>) => {
  if (!r.ok) throw new Error(`error ${r.error}`);
  return r.valor;
};

describe("calcularVuelto", () => {
  it("justo: sin falta, sin sobra, sin vuelto; el neto es lo entregado en efectivo", () => {
    expect(
      valor(calcularVuelto({ total: total("1500.00"), pagos: [pago("EFECTIVO", "1500")] })),
    ).toEqual({
      falta: "0.00",
      sobra: "0.00",
      vuelto: "0.00",
      netoEnEfectivo: "1500.00",
    });
  });
  it("efectivo de más: el vuelto es el sobrante y el neto cuadra con el total", () => {
    expect(
      valor(calcularVuelto({ total: total("1500"), pagos: [pago("EFECTIVO", "2000")] })),
    ).toEqual({
      falta: "0.00",
      sobra: "0.00",
      vuelto: "500.00",
      netoEnEfectivo: "1500.00",
    });
  });
  it("falta: informa lo que falta y no hay vuelto", () => {
    expect(
      valor(calcularVuelto({ total: total("1500"), pagos: [pago("EFECTIVO", "1000.50")] })),
    ).toMatchObject({
      falta: "499.50",
      vuelto: "0.00",
      sobra: "0.00",
    });
  });
  it("mixto: el vuelto sale del efectivo y solo si el efectivo cubre el sobrante", () => {
    const r = valor(
      calcularVuelto({
        total: total("1500"),
        pagos: [pago("TARJETA_DEBITO", "1000"), pago("EFECTIVO", "1000")],
      }),
    );
    expect(r).toMatchObject({ vuelto: "500.00", sobra: "0.00", netoEnEfectivo: "500.00" });
  });
  it("con otro medio no se paga de más: el sobrante queda sin resolver", () => {
    const r = valor(
      calcularVuelto({ total: total("1500"), pagos: [pago("TARJETA_CREDITO", "2000")] }),
    );
    expect(r).toMatchObject({ sobra: "500.00", vuelto: "0.00", netoEnEfectivo: "0.00" });
  });
  it("efectivo que no alcanza a cubrir el sobrante: no hay vuelto parcial", () => {
    const r = valor(
      calcularVuelto({
        total: total("1500"),
        pagos: [pago("QR", "1800"), pago("EFECTIVO", "200")],
      }),
    );
    expect(r).toMatchObject({ sobra: "500.00", vuelto: "0.00", netoEnEfectivo: "200.00" });
  });
  it("sin float: centavos exactos", () => {
    const r = valor(calcularVuelto({ total: total("0.10"), pagos: [pago("EFECTIVO", "0.30")] }));
    expect(r).toMatchObject({ vuelto: "0.20", netoEnEfectivo: "0.10" });
  });
  it("entradas inválidas: sin pagos, demasiados, moneda, forma, cero y total mal escrito", () => {
    const codigo = (r: ReturnType<typeof calcularVuelto>) => (r.ok ? "ok" : r.error);
    expect(codigo(calcularVuelto({ total: total("10"), pagos: [] }))).toBe("PAGOS_INVALIDOS");
    expect(
      codigo(
        calcularVuelto({
          total: total("10"),
          pagos: Array.from({ length: MAXIMO_DE_COBROS_POR_TICKET + 1 }, () =>
            pago("EFECTIVO", "1"),
          ),
        }),
      ),
    ).toBe("PAGOS_INVALIDOS");
    expect(
      codigo(
        calcularVuelto({
          total: total("10"),
          pagos: [{ tipo: "EFECTIVO", importe: { moneda: "USD", monto: "1" } }],
        }),
      ),
    ).toBe("MONEDA_NO_SOPORTADA");
    expect(codigo(calcularVuelto({ total: total("10"), pagos: [pago("EFECTIVO", "1,5")] }))).toBe(
      "IMPORTE_INVALIDO",
    );
    expect(codigo(calcularVuelto({ total: total("10"), pagos: [pago("EFECTIVO", "-5")] }))).toBe(
      "IMPORTE_INVALIDO",
    );
    expect(codigo(calcularVuelto({ total: total("10"), pagos: [pago("EFECTIVO", "0")] }))).toBe(
      "IMPORTE_INVALIDO",
    );
    expect(codigo(calcularVuelto({ total: total("1e3"), pagos: [pago("EFECTIVO", "1")] }))).toBe(
      "IMPORTE_INVALIDO",
    );
  });
  it("propiedad: lo que se manda al servidor (neto) más lo no efectivo cuadra con el total cuando no hay falta ni sobra", () => {
    const centavos = fc.integer({ min: 1, max: 5_000_000 });
    fc.assert(
      fc.property(centavos, centavos, centavos, (t, e, o) => {
        const aTexto = (c: number) => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
        const r = valor(
          calcularVuelto({
            total: total(aTexto(t)),
            pagos: [pago("EFECTIVO", aTexto(e)), pago("QR", aTexto(o))],
          }),
        );
        const neto = Math.round(Number(r.netoEnEfectivo) * 100);
        if (r.falta === "0.00" && r.sobra === "0.00") expect(neto + o).toBe(t);
        expect(Number(r.vuelto) >= 0 && Number(r.sobra) >= 0 && Number(r.falta) >= 0).toBe(true);
        // vuelto y sobra nunca conviven; falta y vuelto tampoco
        expect(r.vuelto !== "0.00" && r.sobra !== "0.00").toBe(false);
        expect(r.vuelto !== "0.00" && r.falta !== "0.00").toBe(false);
      }),
    );
  });
});
