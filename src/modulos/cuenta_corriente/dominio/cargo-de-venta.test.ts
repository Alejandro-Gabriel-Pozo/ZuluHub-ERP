import { describe, expect, it } from "vitest";
import { importeATexto, importeDesdeTexto } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import { FORMA_DE_CLAVE } from "../../../primitivas/libro/clave";
import {
  CLASE_DEL_CARGO_DE_VENTA,
  CLASE_DE_LA_COBRANZA_DE_VENTA,
  DETALLE_DE_LA_ANULACION_DEL_CARGO_DE_VENTA,
  DETALLE_DE_LA_ANULACION_DE_LA_COBRANZA,
  ORIGEN_DEL_CARGO_DE_VENTA,
  ORIGEN_DE_LA_COBRANZA_DE_VENTA,
  claveDeLaAnulacionDeLaCobranza,
  claveDeLaAnulacionDelCargoDeVenta,
  claveDeLaCobranzaDeVenta,
  claveDeLaImputacionDeLaCobranza,
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

describe("claves y constantes de la cobranza", () => {
  const id = "5b6b3f0e-1f2d-4c3a-9d41-0a8f3c2b7e11";
  const otro = "5b6b3f0e-1f2d-4c3a-9d41-0a8f3c2b7e12";
  const CLAVES = [
    claveDelCargoDeVenta,
    claveDeLaAnulacionDelCargoDeVenta,
    claveDeLaCobranzaDeVenta,
    claveDeLaImputacionDeLaCobranza,
    claveDeLaAnulacionDeLaCobranza,
  ] as const;

  it("cada clave es estable: da SIEMPRE los mismos valores para el mismo id (lo ya asentado en el libro se identifica por ellos; cambiar un espacio de nombres reescribiría su identidad)", () => {
    expect(CLAVES.map((clave) => clave(id))).toEqual([
      "3689918f-6fea-5856-9590-3ee58974bb7c",
      "cd3a8a48-3df1-53df-ad94-e018394f21d0",
      "819e30ee-86ed-56ec-86b0-0ae53d75e916",
      "e12254ef-261d-5bf1-add4-8f96882f7d40",
      "31a67e10-2afa-5df5-83ab-1833a2c12d5c",
    ]);
  });

  it("dos ids distintos dan claves distintas en las cinco, y las cinco claves del mismo id son distintas entre sí", () => {
    for (const clave of CLAVES) {
      expect(clave(id)).not.toBe(clave(otro));
      expect(clave(id)).toMatch(FORMA_DE_CLAVE);
    }
    expect(new Set(CLAVES.map((clave) => clave(id))).size).toBe(CLAVES.length);
  });

  it("origen, clase y detalle de la cobranza son los declarados", () => {
    expect(ORIGEN_DE_LA_COBRANZA_DE_VENTA).toBe("ventas.cobranza_de_ticket");
    expect(CLASE_DE_LA_COBRANZA_DE_VENTA).toBe("COBRANZA");
    expect(DETALLE_DE_LA_ANULACION_DE_LA_COBRANZA).toBe("ANULACION-DE-COBRANZA");
  });
});
