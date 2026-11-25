import { describe, expect, it } from "vitest";
import {
  CLAVE_DE_TEXTO_DEL_MEDIO,
  MEDIOS_PARA_ELEGIR,
  esUnMedioDePago,
  pagoListo,
} from "../../apps/web/ui/plantillas/compras/pago/modelo-de-pago";
import { texto } from "../../src/capacidades/vocabulario/vocabulario";
import { MEDIOS_DE_PAGO } from "../../src/modulos/compras/publico";

describe("el modelo de «Declarar pago»", () => {
  it("la lista de medios de la pantalla es la del dominio (una regla, un lugar) y cada uno tiene su texto aprobado", () => {
    expect([...MEDIOS_PARA_ELEGIR]).toEqual([...MEDIOS_DE_PAGO]);
    expect(MEDIOS_PARA_ELEGIR.map((m) => texto({}, CLAVE_DE_TEXTO_DEL_MEDIO[m]))).toEqual([
      "Efectivo",
      "Tarjeta de débito",
      "Tarjeta de crédito",
      "Transferencia",
      "QR",
      "Otro",
    ]);
  });

  it("un valor fuera de la lista no es un medio", () => {
    expect(esUnMedioDePago("CHEQUE")).toBe(false);
    expect(esUnMedioDePago("")).toBe(false);
    expect(esUnMedioDePago("EFECTIVO")).toBe(true);
  });

  it("el botón se puede tocar solo con fecha y medio de la lista; con efectivo, también la caja y el motivo", () => {
    const base = { fecha: "2026-11-24", medio: "", cajaId: "", motivo: "" };
    expect(pagoListo(base)).toBe(false);
    expect(pagoListo({ ...base, medio: "CHEQUE" })).toBe(false);
    expect(pagoListo({ ...base, medio: "TRANSFERENCIA" })).toBe(true);
    expect(pagoListo({ ...base, medio: "TRANSFERENCIA", fecha: "" })).toBe(false);
    expect(pagoListo({ ...base, medio: "EFECTIVO" })).toBe(false);
    expect(pagoListo({ ...base, medio: "EFECTIVO", cajaId: "c1" })).toBe(false);
    expect(pagoListo({ ...base, medio: "EFECTIVO", cajaId: "c1", motivo: "   " })).toBe(false);
    expect(pagoListo({ ...base, medio: "EFECTIVO", cajaId: "c1", motivo: "Pago" })).toBe(true);
  });
});
