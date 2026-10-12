import { describe, expect, it } from "vitest";
import { empresaId } from "../primitivas/identificadores/marca";
import {
  comprobarQueOpera,
  estadoEfectivo,
  puedeOperar,
  type EstadosDeEmpresa,
  type EstadoDeEmpresa,
  type EstadoDeTenant,
  type EstadoEfectivo,
} from "./estados";

describe("estado efectivo = tenant + empresa", () => {
  const casos: [EstadoDeTenant, EstadoDeEmpresa, EstadoEfectivo][] = [
    ["ACTIVE", "ACTIVE", "OPERA"],
    ["ACTIVE", "PROVISIONING", "EMPRESA_EN_ALTA"],
    ["ACTIVE", "SUSPENDED", "EMPRESA_SUSPENDIDA"],
    ["ACTIVE", "CANCELLED", "EMPRESA_CANCELADA"],
    ["ACTIVE", "DELETING", "EMPRESA_EN_BAJA"],
    ["SUSPENDED", "ACTIVE", "TENANT_SUSPENDIDO"],
    ["SUSPENDED", "PROVISIONING", "TENANT_SUSPENDIDO"],
    ["SUSPENDED", "SUSPENDED", "TENANT_SUSPENDIDO"],
    // Los estados finales de la empresa mandan sobre la suspensión del tenant.
    ["SUSPENDED", "CANCELLED", "EMPRESA_CANCELADA"],
    ["SUSPENDED", "DELETING", "EMPRESA_EN_BAJA"],
  ];

  it.each(casos)("tenant %s + empresa %s → %s", (tenant, empresa, esperado) => {
    expect(estadoEfectivo(tenant, empresa)).toBe(esperado);
  });

  it("solo OPERA permite operar", () => {
    const todos: EstadoEfectivo[] = [
      "OPERA",
      "EMPRESA_EN_ALTA",
      "EMPRESA_SUSPENDIDA",
      "EMPRESA_CANCELADA",
      "EMPRESA_EN_BAJA",
      "TENANT_SUSPENDIDO",
    ];
    expect(todos.filter(puedeOperar)).toEqual(["OPERA"]);
  });
});

describe("comprobarQueOpera", () => {
  const E1 = empresaId("e-1");
  const E2 = empresaId("e-2");
  const estados = (...filas: [typeof E1, EstadoDeEmpresa, EstadoDeTenant][]): EstadosDeEmpresa =>
    new Map(filas.map(([id, empresa, tenant]) => [id, { empresa, tenant }]));

  it("una empresa activa de un tenant activo opera: ok", () => {
    expect(comprobarQueOpera(E1, estados([E1, "ACTIVE", "ACTIVE"]))).toEqual({
      ok: true,
      valor: null,
    });
  });

  const noOperan: [EstadoDeTenant, EstadoDeEmpresa, EstadoEfectivo][] = [
    ["ACTIVE", "PROVISIONING", "EMPRESA_EN_ALTA"],
    ["ACTIVE", "SUSPENDED", "EMPRESA_SUSPENDIDA"],
    ["ACTIVE", "CANCELLED", "EMPRESA_CANCELADA"],
    ["ACTIVE", "DELETING", "EMPRESA_EN_BAJA"],
    ["SUSPENDED", "ACTIVE", "TENANT_SUSPENDIDO"],
    ["SUSPENDED", "CANCELLED", "EMPRESA_CANCELADA"],
  ];

  it.each(noOperan)(
    "tenant %s + empresa %s: EMPRESA_NO_OPERA con el motivo %s y la empresa que no opera",
    (tenant, empresa, motivo) => {
      expect(comprobarQueOpera(E1, estados([E1, empresa, tenant]))).toEqual({
        ok: false,
        error: { codigo: "EMPRESA_NO_OPERA", empresaId: E1, motivo },
      });
    },
  );

  it("mira la empresa pedida, no las demás", () => {
    const todas = estados([E1, "ACTIVE", "ACTIVE"], [E2, "SUSPENDED", "ACTIVE"]);
    expect(comprobarQueOpera(E1, todas).ok).toBe(true);
    expect(comprobarQueOpera(E2, todas)).toEqual({
      ok: false,
      error: { codigo: "EMPRESA_NO_OPERA", empresaId: E2, motivo: "EMPRESA_SUSPENDIDA" },
    });
  });

  it("si falta el estado de la empresa es un error del llamador: lanza, no autoriza a ciegas", () => {
    expect(() => comprobarQueOpera(E2, estados([E1, "ACTIVE", "ACTIVE"]))).toThrow(
      new RangeError("falta el estado de la empresa e-2"),
    );
    expect(() => comprobarQueOpera(E1, new Map())).toThrow(RangeError);
  });
});
