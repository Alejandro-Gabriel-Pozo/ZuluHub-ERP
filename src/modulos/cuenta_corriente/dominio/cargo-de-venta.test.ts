import { describe, expect, it } from "vitest";
import { importeATexto, importeDesdeTexto } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import { FORMA_DE_CLAVE } from "../../../primitivas/libro/clave";
import {
  CLASE_DEL_CARGO_DE_VENTA,
  DETALLE_DE_LA_ANULACION_DEL_CARGO_DE_VENTA,
  ORIGEN_DEL_CARGO_DE_VENTA,
  claveDeLaAnulacionDelCargoDeVenta,
  claveDelCargoDeVenta,
  excesoDelLimite,
} from "./cargo-de-venta";

const ars = (texto: string) => importeDesdeTexto(ARS, texto);
const exceso = (limite: string, saldo: string, total: string) => {
  const r = excesoDelLimite(ars(limite), ars(saldo), ars(total));
  return r === null ? null : importeATexto(r);
};

describe("excesoDelLimite", () => {
  it("el saldo IGUAL al límite pasa y un centavo más es el exceso", () => {
    expect(exceso("1000.00", "0.00", "1000.00")).toBeNull();
    expect(exceso("999.99", "0.00", "1000.00")).toBe("0.01");
    expect(exceso("1000.00", "400.00", "600.00")).toBeNull();
    expect(exceso("1000.00", "400.00", "600.01")).toBe("0.01");
  });

  it("el exceso es cuánto se pasa, no el total; un saldo a favor suma al margen; un saldo ya excedido solo crece", () => {
    expect(exceso("1000.00", "900.00", "500.00")).toBe("400.00");
    expect(exceso("1000.00", "-300.00", "1300.00")).toBeNull();
    expect(exceso("1000.00", "-300.00", "1300.01")).toBe("0.01");
    expect(exceso("1000.00", "1500.00", "100.00")).toBe("600.00");
  });
});

describe("claves y constantes del cargo", () => {
  const ticket = "5b6b3f0e-1f2d-4c3a-9d41-0a8f3c2b7e11";
  it("la clave sale del ticket: la misma para el mismo ticket, otra para otro, y distinta de la de la anulación; todas con la forma de las claves del libro", () => {
    const a = claveDelCargoDeVenta(ticket);
    expect(a).toBe(claveDelCargoDeVenta(ticket));
    expect(a).not.toBe(claveDelCargoDeVenta("5b6b3f0e-1f2d-4c3a-9d41-0a8f3c2b7e12"));
    expect(a).not.toBe(claveDeLaAnulacionDelCargoDeVenta(ticket));
    expect(claveDeLaAnulacionDelCargoDeVenta(ticket)).toBe(
      claveDeLaAnulacionDelCargoDeVenta(ticket),
    );
    expect(a).toMatch(FORMA_DE_CLAVE);
    expect(claveDeLaAnulacionDelCargoDeVenta(ticket)).toMatch(FORMA_DE_CLAVE);
  });

  it("origen, clase y detalle son los declarados (la identidad de lo ya asentado no cambia)", () => {
    expect(ORIGEN_DEL_CARGO_DE_VENTA).toBe("ventas.ticket");
    expect(CLASE_DEL_CARGO_DE_VENTA).toBe("CARGO_DE_VENTA_A_CUENTA");
    expect(DETALLE_DE_LA_ANULACION_DEL_CARGO_DE_VENTA).toBe("ANULACION-DE-TICKET");
  });
});
