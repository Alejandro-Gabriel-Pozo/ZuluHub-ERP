import { describe, expect, it } from "vitest";
import {
  CLASES_DE_MOVIMIENTO,
  DATOS_DEL_COBRO,
  ESTADOS_DE_CONTEO,
  ESTADOS_DE_SESION,
  TIPOS_DE_CUENTA,
  TIPOS_DE_MEDIO,
} from "./estados";

describe("los vocabularios cerrados de caja (los CHECK de 0027)", () => {
  it("estados de la sesión", () => {
    expect([...ESTADOS_DE_SESION]).toEqual(["ABIERTA", "EN_CIERRE", "CERRADA"]);
  });
  it("clases de movimiento, sin devolución (decisión 152)", () => {
    expect([...CLASES_DE_MOVIMIENTO]).toEqual([
      "FONDO_INICIAL",
      "COBRO",
      "INGRESO_MANUAL",
      "EGRESO_MANUAL",
      "AJUSTE",
      "ANULACION",
    ]);
  });
  it("tipos de medio y de cuenta", () => {
    expect([...TIPOS_DE_MEDIO]).toEqual([
      "EFECTIVO",
      "TARJETA_DEBITO",
      "TARJETA_CREDITO",
      "TRANSFERENCIA",
      "QR",
      "OTRO",
    ]);
    expect([...TIPOS_DE_CUENTA]).toEqual(["TERMINAL", "QR", "CUENTA_BANCARIA"]);
  });
  it("datos del cobro y estados de conteo", () => {
    expect([...DATOS_DEL_COBRO]).toEqual(["cupon", "ultimos4", "marca", "cuotas", "dni"]);
    expect([...ESTADOS_DE_CONTEO]).toEqual(["CONTADO", "DECLARADO", "CONFORME", "SIN_DATO"]);
  });
});
