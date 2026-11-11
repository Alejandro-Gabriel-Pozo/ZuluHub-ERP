import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../../test/propiedades/configuracion";
import { estadoDeMesa, type CuentaParaElEstado } from "./estado-de-mesa";

const cuenta = fc.record({ pendientes: fc.nat(5), envios: fc.nat(5) });

describe("estadoDeMesa", () => {
  it("sin cuenta abierta está libre", () => {
    expect(estadoDeMesa({ cuentas: [], unidaAMesa: null })).toBe("LIBRE");
  });
  it("con la cuenta recién abierta (nada enviado) está en pedido", () => {
    expect(estadoDeMesa({ cuentas: [{ pendientes: 0, envios: 0 }], unidaAMesa: null })).toBe(
      "EN_PEDIDO",
    );
  });
  it("con algo sin enviar o en espera está en pedido aunque ya haya envíos", () => {
    expect(estadoDeMesa({ cuentas: [{ pendientes: 1, envios: 2 }], unidaAMesa: null })).toBe(
      "EN_PEDIDO",
    );
  });
  it("con envíos y nada pendiente está ocupada", () => {
    expect(estadoDeMesa({ cuentas: [{ pendientes: 0, envios: 1 }], unidaAMesa: null })).toBe(
      "OCUPADA",
    );
  });
  it("la mesa unida lo es aunque su cuenta de reserva no tenga nada", () => {
    expect(estadoDeMesa({ cuentas: [{ pendientes: 0, envios: 0 }], unidaAMesa: 5 })).toBe("UNIDA");
  });
  it("una mesa dividida se muestra según la hija más atrasada", () => {
    const ocupada = { pendientes: 0, envios: 1 };
    const enPedido = { pendientes: 2, envios: 1 };
    expect(estadoDeMesa({ cuentas: [ocupada, enPedido], unidaAMesa: null })).toBe("EN_PEDIDO");
    expect(estadoDeMesa({ cuentas: [ocupada, ocupada], unidaAMesa: null })).toBe("OCUPADA");
  });

  it("propiedad: es función de sus cuentas, sin importar el orden", () => {
    fc.assert(
      fc.property(fc.array(cuenta, { maxLength: 4 }), (cuentas: CuentaParaElEstado[]) => {
        const a = estadoDeMesa({ cuentas, unidaAMesa: null });
        expect(estadoDeMesa({ cuentas: [...cuentas].reverse(), unidaAMesa: null })).toBe(a);
        expect(a === "LIBRE").toBe(cuentas.length === 0);
      }),
    );
  });
});
