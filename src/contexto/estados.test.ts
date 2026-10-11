import { describe, expect, it } from "vitest";
import {
  estadoEfectivo,
  puedeOperar,
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
