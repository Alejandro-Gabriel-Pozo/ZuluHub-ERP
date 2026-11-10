import { describe, expect, it } from "vitest";
import { importeDesdeTexto } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import { precioUnitarioDesdeTexto } from "../../../primitivas/dinero/precio-unitario";
import {
  CONFIRMACIONES_DE_VENTA,
  confirmacionesDesdeTexto,
  decidirAgregarLinea,
  decidirAnularCuenta,
  decidirAnularLinea,
  decidirAnularTicket,
  decidirCierre,
} from "./decisiones";

const precio = (t: string) => precioUnitarioDesdeTexto(t);
const total = (t: string) => importeDesdeTexto(ARS, t);

describe("confirmacionesDesdeTexto (lista de permitidos)", () => {
  it("sin confirmaciones o con las declaradas pasa", () => {
    expect(CONFIRMACIONES_DE_VENTA).toEqual(["VENTA_A_CERO"]);
    expect(confirmacionesDesdeTexto(undefined)).toEqual({ ok: true, valor: [] });
    expect(confirmacionesDesdeTexto(["VENTA_A_CERO"])).toEqual({
      ok: true,
      valor: ["VENTA_A_CERO"],
    });
  });
  it("cualquier otra cosa es un pedido mal formado, también si viene junto a una válida", () => {
    expect(confirmacionesDesdeTexto(["OTRA"])).toEqual({
      ok: false,
      error: "CONFIRMACION_INVALIDA",
    });
    expect(confirmacionesDesdeTexto(["VENTA_A_CERO", "venta_a_cero"])).toEqual({
      ok: false,
      error: "CONFIRMACION_INVALIDA",
    });
  });
});

describe("decidirAgregarLinea", () => {
  const base = {
    estadoDeLaCuenta: "ABIERTA",
    precioUnitario: precio("10"),
    confirmaciones: [],
  } as const;
  it("a una cuenta abierta con precio se agrega", () => {
    expect(decidirAgregarLinea(base)).toEqual({ ok: true, valor: null });
  });
  it("a una cuenta cerrada o anulada, no", () => {
    expect(decidirAgregarLinea({ ...base, estadoDeLaCuenta: "CERRADA" })).toEqual({
      ok: false,
      error: "CUENTA_NO_ABIERTA",
    });
    expect(decidirAgregarLinea({ ...base, estadoDeLaCuenta: "ANULADA" })).toEqual({
      ok: false,
      error: "CUENTA_NO_ABIERTA",
    });
  });
  it("una línea a $0 pide la confirmación VENTA_A_CERO; con ella pasa", () => {
    const cero = { ...base, precioUnitario: precio("0") };
    expect(decidirAgregarLinea(cero)).toEqual({
      ok: false,
      error: { error: "CONFIRMACION_REQUERIDA", clave: "VENTA_A_CERO" },
    });
    expect(decidirAgregarLinea({ ...cero, confirmaciones: ["VENTA_A_CERO"] })).toEqual({
      ok: true,
      valor: null,
    });
  });
  it("el estado manda sobre la confirmación: cuenta cerrada con línea a $0 sin confirmar es CUENTA_NO_ABIERTA", () => {
    expect(
      decidirAgregarLinea({ ...base, estadoDeLaCuenta: "CERRADA", precioUnitario: precio("0") }),
    ).toEqual({
      ok: false,
      error: "CUENTA_NO_ABIERTA",
    });
  });
});

describe("decidirAnularLinea", () => {
  it("vigente en cuenta abierta: se anula", () => {
    expect(decidirAnularLinea({ estadoDeLaLinea: "VIGENTE", estadoDeLaCuenta: "ABIERTA" })).toEqual(
      { ok: true, valor: "ANULAR" },
    );
  });
  it("vigente en cuenta resuelta: CUENTA_NO_ABIERTA", () => {
    for (const estadoDeLaCuenta of ["CERRADA", "ANULADA"] as const) {
      expect(decidirAnularLinea({ estadoDeLaLinea: "VIGENTE", estadoDeLaCuenta })).toEqual({
        ok: false,
        error: "CUENTA_NO_ABIERTA",
      });
    }
  });
  it("ya anulada es repetición, aunque la cuenta ya esté resuelta", () => {
    for (const estadoDeLaCuenta of ["ABIERTA", "CERRADA", "ANULADA"] as const) {
      expect(decidirAnularLinea({ estadoDeLaLinea: "ANULADA", estadoDeLaCuenta })).toEqual({
        ok: true,
        valor: "YA_ESTABA_ANULADA",
      });
    }
  });
});

describe("decidirAnularCuenta", () => {
  it("abierta se anula; anulada es repetición; cerrada no se anula", () => {
    expect(decidirAnularCuenta("ABIERTA")).toEqual({ ok: true, valor: "ANULAR" });
    expect(decidirAnularCuenta("ANULADA")).toEqual({ ok: true, valor: "YA_ESTABA_ANULADA" });
    expect(decidirAnularCuenta("CERRADA")).toEqual({ ok: false, error: "CUENTA_CERRADA" });
  });
});

describe("decidirCierre (§3.5 pasos 1 y 2)", () => {
  const abierta = {
    estadoDeLaCuenta: "ABIERTA",
    total: total("100"),
    preciosDeLasLineasVigentes: [precio("100")],
    confirmaciones: [],
  } as const;
  it("cerrada es repetición; anulada es error (por estado, antes de mirar las líneas)", () => {
    expect(
      decidirCierre({ ...abierta, estadoDeLaCuenta: "CERRADA", preciosDeLasLineasVigentes: [] }),
    ).toEqual({
      ok: true,
      valor: { tipo: "YA_CERRADA" },
    });
    expect(
      decidirCierre({ ...abierta, estadoDeLaCuenta: "ANULADA", preciosDeLasLineasVigentes: [] }),
    ).toEqual({
      ok: false,
      error: "CUENTA_ANULADA",
    });
  });
  it("sin líneas vigentes no se cierra", () => {
    expect(
      decidirCierre({ ...abierta, total: total("0"), preciosDeLasLineasVigentes: [] }),
    ).toEqual({
      ok: false,
      error: "CUENTA_SIN_LINEAS",
    });
  });
  it("con total mayor que 0 se emite sin confirmación y sin marca de cortesía", () => {
    expect(decidirCierre(abierta)).toEqual({
      ok: true,
      valor: { tipo: "CERRAR", estadoDelTicket: "EMITIDO", cortesia: null },
    });
  });
  it("total 0: exige VENTA_A_CERO; con ella el ticket nace CORTESIA total", () => {
    const cero = { ...abierta, total: total("0"), preciosDeLasLineasVigentes: [precio("0")] };
    expect(decidirCierre(cero)).toEqual({
      ok: false,
      error: { error: "CONFIRMACION_REQUERIDA", clave: "VENTA_A_CERO" },
    });
    expect(decidirCierre({ ...cero, confirmaciones: ["VENTA_A_CERO"] })).toEqual({
      ok: true,
      valor: { tipo: "CERRAR", estadoDelTicket: "CORTESIA", cortesia: "TOTAL" },
    });
  });
  it("una línea a $0 en un total mayor que 0 ya se confirmó al agregarla: el ticket sigue EMITIDO y queda marcado PARCIAL", () => {
    expect(
      decidirCierre({ ...abierta, preciosDeLasLineasVigentes: [precio("0"), precio("100")] }),
    ).toEqual({
      ok: true,
      valor: { tipo: "CERRAR", estadoDelTicket: "EMITIDO", cortesia: "PARCIAL" },
    });
  });
});

describe("decidirAnularTicket (§3.8)", () => {
  const entrada = {
    estadoDelTicket: "COBRADO",
    ejemplarVigenteId: "e2",
    ejemplarBaseId: "e2",
  } as const;
  it("con el ejemplar que vio quien anula, se anula (cobrado, emitido o cortesía)", () => {
    for (const estadoDelTicket of ["EMITIDO", "COBRADO", "CORTESIA"] as const) {
      expect(decidirAnularTicket({ ...entrada, estadoDelTicket })).toEqual({
        ok: true,
        valor: null,
      });
    }
  });
  it("uno ya anulado es TICKET_ANULADO, aunque el ejemplar visto sea otro", () => {
    expect(decidirAnularTicket({ ...entrada, estadoDelTicket: "ANULADO" })).toEqual({
      ok: false,
      error: "TICKET_ANULADO",
    });
    expect(
      decidirAnularTicket({ ...entrada, estadoDelTicket: "ANULADO", ejemplarBaseId: "e1" }),
    ).toEqual({
      ok: false,
      error: "TICKET_ANULADO",
    });
  });
  it("con un ejemplar que ya no es el vigente, EJEMPLAR_DESACTUALIZADO", () => {
    expect(decidirAnularTicket({ ...entrada, ejemplarBaseId: "e1" })).toEqual({
      ok: false,
      error: "EJEMPLAR_DESACTUALIZADO",
    });
  });
});
