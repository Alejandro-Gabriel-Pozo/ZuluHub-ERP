import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../test/propiedades/configuracion";
import { MAXIMO_DE_COBROS_POR_TICKET } from "./limites-de-cobro";
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
  it("borde: lo entregado EXACTAMENTE igual al total no tiene falta, sobra ni vuelto (mixto y de a un centavo)", () => {
    expect(
      valor(
        calcularVuelto({
          total: total("1500"),
          pagos: [pago("QR", "1000"), pago("EFECTIVO", "500")],
        }),
      ),
    ).toEqual({ falta: "0.00", sobra: "0.00", vuelto: "0.00", netoEnEfectivo: "500.00" });
    expect(
      valor(calcularVuelto({ total: total("0.01"), pagos: [pago("EFECTIVO", "0.01")] })),
    ).toMatchObject({
      falta: "0.00",
      vuelto: "0.00",
      sobra: "0.00",
    });
    // Un centavo de menos es falta; un centavo de más es vuelto.
    expect(
      valor(calcularVuelto({ total: total("10"), pagos: [pago("EFECTIVO", "9.99")] })),
    ).toMatchObject({ falta: "0.01", vuelto: "0.00" });
    expect(
      valor(calcularVuelto({ total: total("10"), pagos: [pago("EFECTIVO", "10.01")] })),
    ).toMatchObject({ vuelto: "0.01", netoEnEfectivo: "10.00" });
  });
  it("borde: el efectivo EXACTAMENTE igual al sobrante lo cubre justo (vuelto, neto en cero); un centavo menos no hay vuelto", () => {
    expect(
      valor(
        calcularVuelto({
          total: total("1500"),
          pagos: [pago("QR", "1500"), pago("EFECTIVO", "200")],
        }),
      ),
    ).toEqual({ falta: "0.00", sobra: "0.00", vuelto: "200.00", netoEnEfectivo: "0.00" });
    expect(
      valor(
        calcularVuelto({
          total: total("1500"),
          pagos: [pago("QR", "1700"), pago("EFECTIVO", "199.99")],
        }),
      ),
    ).toEqual({ falta: "0.00", sobra: "399.99", vuelto: "0.00", netoEnEfectivo: "199.99" });
  });
  it("borde: exactamente el máximo de pagos es válido y uno más se rechaza", () => {
    const pagos = (n: number) => Array.from({ length: n }, () => pago("EFECTIVO", "1"));
    expect(
      calcularVuelto({
        total: total(String(MAXIMO_DE_COBROS_POR_TICKET)),
        pagos: pagos(MAXIMO_DE_COBROS_POR_TICKET),
      }).ok,
    ).toBe(true);
    const r = calcularVuelto({ total: total("1"), pagos: pagos(MAXIMO_DE_COBROS_POR_TICKET + 1) });
    expect(r.ok ? "ok" : r.error).toBe("PAGOS_INVALIDOS");
    expect(calcularVuelto({ total: total("1"), pagos: pagos(1) }).ok).toBe(true);
  });
  it("propiedad: lo que se manda al servidor (neto) más lo no efectivo cuadra con el total cuando no hay falta ni sobra", () => {
    const centavos = fc.integer({ min: 1, max: 5_000_000 });
    fc.assert(
      fc.property(centavos, centavos, centavos, (t, e, o) => {
        // Sin `number` para dinero (ADR-006): la cuenta de control se hace en centavos enteros (`bigint`).
        const aTexto = (c: number) =>
          `${String(BigInt(c) / 100n)}.${String(BigInt(c) % 100n).padStart(2, "0")}`;
        const aCentavos = (texto: string) => BigInt(texto.replace(".", ""));
        const r = valor(
          calcularVuelto({
            total: total(aTexto(t)),
            pagos: [pago("EFECTIVO", aTexto(e)), pago("QR", aTexto(o))],
          }),
        );
        const neto = aCentavos(r.netoEnEfectivo);
        if (r.falta === "0.00" && r.sobra === "0.00") expect(neto + BigInt(o)).toBe(BigInt(t));
        expect([r.vuelto, r.sobra, r.falta].some((x) => x.startsWith("-"))).toBe(false);
        // vuelto y sobra nunca conviven; falta y vuelto tampoco
        expect(r.vuelto !== "0.00" && r.sobra !== "0.00").toBe(false);
        expect(r.vuelto !== "0.00" && r.falta !== "0.00").toBe(false);
      }),
    );
  });
});
