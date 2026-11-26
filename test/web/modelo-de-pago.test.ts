import { describe, expect, it } from "vitest";
import {
  CLAVE_DE_TEXTO_DEL_MEDIO,
  MEDIOS_PARA_ELEGIR,
  esUnMedioDePago,
  hayEfectivo,
  mediosParaLaFila,
  pagoListo,
  pedidoDeMedios,
  sePuedeAgregarUnMedio,
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

  const fila = (id: number, medio: string, importe = "") => ({ id, medio, importe });
  const pago = (filas: ReturnType<typeof fila>[], cambios = {}) => ({
    fecha: "2026-11-24",
    filas,
    cajaId: "",
    motivo: "",
    ...cambios,
  });

  it("con una sola fila el botón se puede tocar solo con fecha y medio de la lista; con efectivo, también la caja y el motivo", () => {
    expect(pagoListo(pago([fila(0, "")]))).toBe(false);
    expect(pagoListo(pago([]))).toBe(false);
    expect(pagoListo(pago([fila(0, "CHEQUE")]))).toBe(false);
    expect(pagoListo(pago([fila(0, "TRANSFERENCIA")]))).toBe(true);
    expect(pagoListo(pago([fila(0, "TRANSFERENCIA")], { fecha: "" }))).toBe(false);
    expect(pagoListo(pago([fila(0, "EFECTIVO")]))).toBe(false);
    expect(pagoListo(pago([fila(0, "EFECTIVO")], { cajaId: "c1" }))).toBe(false);
    expect(pagoListo(pago([fila(0, "EFECTIVO")], { cajaId: "c1", motivo: "   " }))).toBe(false);
    expect(pagoListo(pago([fila(0, "EFECTIVO")], { cajaId: "c1", motivo: "Pago" }))).toBe(true);
  });

  it("con varias filas cada una dice cuánto paga y no se repite el medio; la suma no se mira acá (la decide el servidor)", () => {
    expect(pagoListo(pago([fila(0, "QR", "1.00"), fila(1, "OTRO", "2.00")]))).toBe(true);
    expect(pagoListo(pago([fila(0, "QR", "1.00"), fila(1, "OTRO")]))).toBe(false);
    expect(pagoListo(pago([fila(0, "QR", "1.00"), fila(1, "OTRO", "  ")]))).toBe(false);
    expect(pagoListo(pago([fila(0, "QR", "1.00"), fila(1, "QR", "2.00")]))).toBe(false);
    expect(pagoListo(pago([fila(0, "QR", "1.00"), fila(1, "", "2.00")]))).toBe(false);
    expect(
      pagoListo(pago([fila(0, "EFECTIVO", "1.00"), fila(1, "QR", "2.00")], { cajaId: "c1" })),
    ).toBe(false);
  });

  it("se pide la caja si alguna fila es efectivo, y se puede sumar un medio mientras quede un tipo sin usar", () => {
    expect(hayEfectivo([fila(0, "QR"), fila(1, "EFECTIVO")])).toBe(true);
    expect(hayEfectivo([fila(0, "QR")])).toBe(false);
    const casi = MEDIOS_PARA_ELEGIR.slice(0, 5).map((m, i) => fila(i, m));
    expect(sePuedeAgregarUnMedio(casi)).toBe(true);
    expect(sePuedeAgregarUnMedio(MEDIOS_PARA_ELEGIR.map((m, i) => fila(i, m)))).toBe(false);
  });

  it("cada fila ofrece su medio y los que nadie eligió, nunca el de otra fila", () => {
    const filas = [fila(0, "QR"), fila(1, "OTRO"), fila(2, "")];
    expect(mediosParaLaFila(filas, filas[0] as never)).toEqual([
      "EFECTIVO",
      "TARJETA_DEBITO",
      "TARJETA_CREDITO",
      "TRANSFERENCIA",
      "QR",
    ]);
    expect(mediosParaLaFila(filas, filas[2] as never)).toEqual([
      "EFECTIVO",
      "TARJETA_DEBITO",
      "TARJETA_CREDITO",
      "TRANSFERENCIA",
    ]);
  });

  it("un medio viaja solo (lleva el total); varios viajan con su importe y en el orden de las filas", () => {
    expect(pedidoDeMedios(["QR"], ["99.00"])).toEqual({ medio: "QR" });
    expect(pedidoDeMedios(["EFECTIVO", "QR"], ["1.00", "2.00"])).toEqual({
      medios: [
        { medio: "EFECTIVO", importe: "1.00" },
        { medio: "QR", importe: "2.00" },
      ],
    });
    expect(pedidoDeMedios(["EFECTIVO", "QR"], ["1.00"])).toEqual({
      medios: [
        { medio: "EFECTIVO", importe: "1.00" },
        { medio: "QR", importe: "" },
      ],
    });
    expect(pedidoDeMedios([], [])).toEqual({ medios: [] });
  });
});
