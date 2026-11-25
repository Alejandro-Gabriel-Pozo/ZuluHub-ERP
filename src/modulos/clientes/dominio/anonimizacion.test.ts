import { describe, expect, it } from "vitest";
import {
  MODULOS_QUE_IMPIDEN_ANONIMIZAR,
  MOTIVOS_DE_ANONIMIZACION,
  MOTIVOS_DE_IMPEDIMENTO,
  decidirAnonimizacion,
  esMotivoDeAnonimizacion,
  type ImpedimentoDeAnonimizacion,
} from "./anonimizacion";
import { ESTADOS_DE_PARTE } from "./estados";

const SALDO: ImpedimentoDeAnonimizacion = {
  modulo: "saldos_de_partes",
  motivo: "SALDO_DISTINTO_DE_CERO",
};

describe("motivos de anonimización (lista cerrada)", () => {
  it("son exactamente el pedido del titular y la baja de la empresa", () => {
    expect([...MOTIVOS_DE_ANONIMIZACION]).toEqual(["PEDIDO_DEL_TITULAR", "BAJA_DE_EMPRESA"]);
  });

  it.each(MOTIVOS_DE_ANONIMIZACION)("admite %s", (motivo) => {
    expect(esMotivoDeAnonimizacion(motivo)).toBe(true);
  });

  it.each([
    "",
    "pedido_del_titular",
    " PEDIDO_DEL_TITULAR",
    "OTRO",
    "constructor",
    "__proto__",
    "toString",
    null,
    undefined,
    7,
    {},
    ["PEDIDO_DEL_TITULAR"],
  ])("rechaza %j", (valor) => {
    expect(esMotivoDeAnonimizacion(valor)).toBe(false);
  });
});

describe("lo que puede impedir anonimizar (códigos, nunca datos de la parte)", () => {
  it("hoy solo el libro de saldos, por saldo distinto de cero", () => {
    expect([...MODULOS_QUE_IMPIDEN_ANONIMIZAR]).toEqual(["saldos_de_partes"]);
    expect([...MOTIVOS_DE_IMPEDIMENTO]).toEqual(["SALDO_DISTINTO_DE_CERO"]);
  });
});

describe("decidirAnonimizacion", () => {
  it("una parte activa o desactivada sin impedimentos se anonimiza", () => {
    expect(decidirAnonimizacion("ACTIVA", [])).toEqual({ tipo: "ANONIMIZAR" });
    expect(decidirAnonimizacion("INACTIVA", [])).toEqual({ tipo: "ANONIMIZAR" });
  });

  it("un impedimento alcanza para no anonimizar, activa o desactivada, y se devuelven todos", () => {
    const otro: ImpedimentoDeAnonimizacion = {
      modulo: "saldos_de_partes",
      motivo: "SALDO_DISTINTO_DE_CERO",
    };
    for (const estado of ["ACTIVA", "INACTIVA"] as const) {
      expect(decidirAnonimizacion(estado, [SALDO])).toEqual({
        tipo: "IMPEDIDA",
        impedimentos: [SALDO],
      });
      expect(decidirAnonimizacion(estado, [SALDO, otro])).toEqual({
        tipo: "IMPEDIDA",
        impedimentos: [SALDO, otro],
      });
    }
  });

  it("una parte ya anonimizada es YA_ESTABA, con o sin impedimentos (la repetición no falla)", () => {
    expect(decidirAnonimizacion("ANONIMIZADA", [])).toEqual({ tipo: "YA_ESTABA" });
    expect(decidirAnonimizacion("ANONIMIZADA", [SALDO])).toEqual({ tipo: "YA_ESTABA" });
  });

  it("decide algo para cada estado que existe y nada más", () => {
    expect(ESTADOS_DE_PARTE.map((estado) => decidirAnonimizacion(estado, []).tipo)).toEqual([
      "ANONIMIZAR",
      "ANONIMIZAR",
      "YA_ESTABA",
    ]);
  });
});
