import { describe, expect, it } from "vitest";
import { tenantId } from "../../../primitivas/identificadores/marca";
import { nombreDeTenantValido, reactivar, suspender, type Tenant } from "./tenant";

const tenant = (estado: Tenant["estado"]): Tenant => ({
  id: tenantId("t-1"),
  nombre: "Hotelera del Sur",
  estado,
  motivoEstado: estado === "SUSPENDED" ? "falta de pago" : null,
  version: 3,
});

describe("tenant", () => {
  it("el nombre se limpia y no puede quedar vacío", () => {
    expect(nombreDeTenantValido("  Hotelera  ")).toEqual({ ok: true, valor: "Hotelera" });
    expect(nombreDeTenantValido("   ")).toEqual({ ok: false, error: "NOMBRE_INVALIDO" });
    expect(nombreDeTenantValido("")).toEqual({ ok: false, error: "NOMBRE_INVALIDO" });
  });

  it("suspender exige motivo y devuelve el cambio a persistir", () => {
    expect(suspender(tenant("ACTIVE"), "  falta de pago ")).toEqual({
      ok: true,
      valor: { estado: "SUSPENDED", motivoEstado: "falta de pago" },
    });
    expect(suspender(tenant("ACTIVE"), "   ")).toEqual({ ok: false, error: "MOTIVO_OBLIGATORIO" });
    expect(suspender(tenant("ACTIVE"), "")).toEqual({ ok: false, error: "MOTIVO_OBLIGATORIO" });
  });

  it("no se suspende dos veces, aun con motivo vacío (primero se informa el estado)", () => {
    expect(suspender(tenant("SUSPENDED"), "otra vez")).toEqual({
      ok: false,
      error: "TENANT_YA_SUSPENDIDO",
    });
    expect(suspender(tenant("SUSPENDED"), "")).toEqual({
      ok: false,
      error: "TENANT_YA_SUSPENDIDO",
    });
  });

  it("reactivar limpia el motivo, y solo se reactiva lo suspendido", () => {
    expect(reactivar(tenant("SUSPENDED"))).toEqual({
      ok: true,
      valor: { estado: "ACTIVE", motivoEstado: null },
    });
    expect(reactivar(tenant("ACTIVE"))).toEqual({ ok: false, error: "TENANT_NO_SUSPENDIDO" });
  });
});
