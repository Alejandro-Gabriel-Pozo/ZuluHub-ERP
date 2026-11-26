import { describe, expect, it } from "vitest";
import {
  MODULOS_QUE_IMPIDEN_ANONIMIZAR,
  MOTIVOS_DE_ANONIMIZACION,
  MOTIVOS_DE_IMPEDIMENTO,
  decidirAnonimizacion,
  esMotivoDeAnonimizacion,
  type ImpedimentoDeAnonimizacion,
} from "./anonimizacion";

const SALDO: ImpedimentoDeAnonimizacion = {
  modulo: "saldos_de_partes",
  motivo: "SALDO_DISTINTO_DE_CERO",
};

describe("anonimización: listas cerradas y decisión", () => {
  it("los motivos, los módulos y los impedimentos admitidos son exactamente estos", () => {
    expect([...MOTIVOS_DE_ANONIMIZACION]).toEqual(["PEDIDO_DEL_TITULAR", "BAJA_DE_EMPRESA"]);
    expect([...MODULOS_QUE_IMPIDEN_ANONIMIZAR]).toEqual(["saldos_de_partes", "cuenta_corriente"]);
    expect([...MOTIVOS_DE_IMPEDIMENTO]).toEqual([
      "SALDO_DISTINTO_DE_CERO",
      "CUENTA_CORRIENTE_DEL_CLIENTE",
    ]);
  });

  it("un motivo se admite solo si es uno de la lista, tal cual", () => {
    for (const motivo of MOTIVOS_DE_ANONIMIZACION)
      expect(esMotivoDeAnonimizacion(motivo)).toBe(true);
    for (const otro of ["", "pedido_del_titular", " BAJA_DE_EMPRESA", "toString", null, 7, {}]) {
      expect(esMotivoDeAnonimizacion(otro)).toBe(false);
    }
  });

  it("se anonimiza una parte activa o desactivada sin impedimentos; un impedimento lo frena; una anonimizada ya estaba", () => {
    expect(decidirAnonimizacion("ACTIVA", [])).toEqual({ tipo: "ANONIMIZAR" });
    expect(decidirAnonimizacion("INACTIVA", [])).toEqual({ tipo: "ANONIMIZAR" });
    for (const estado of ["ACTIVA", "INACTIVA"] as const) {
      expect(decidirAnonimizacion(estado, [SALDO, SALDO])).toEqual({
        tipo: "IMPEDIDA",
        impedimentos: [SALDO, SALDO],
      });
    }
    expect(decidirAnonimizacion("ANONIMIZADA", [])).toEqual({ tipo: "YA_ESTABA" });
    expect(decidirAnonimizacion("ANONIMIZADA", [SALDO])).toEqual({ tipo: "YA_ESTABA" });
  });
});
