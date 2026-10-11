import { describe, expect, it } from "vitest";
import type { EstadoDeEmpresa } from "../../../contexto/estados";
import type { Cuit } from "../../../primitivas/identificacion-fiscal/cuit";
import { empresaId, sucursalId, tenantId } from "../../../primitivas/identificadores/marca";
import { TRANSICIONES_DE_EMPRESA, cambiarEstado, razonSocialValida, type Empresa } from "./empresa";
import { nombreDeSucursalValido, type Sucursal } from "./sucursal";

const ESTADOS: EstadoDeEmpresa[] = ["PROVISIONING", "ACTIVE", "SUSPENDED", "CANCELLED", "DELETING"];

const empresa = (estado: EstadoDeEmpresa): Empresa => ({
  id: empresaId("e-1"),
  tenantId: tenantId("t-1"),
  cuit: "20123456786" as Cuit,
  razonSocial: "Hotel Sur SA",
  estado,
  motivoEstado: null,
  zonaHoraria: "America/Argentina/Buenos_Aires",
  version: 1,
});

describe("empresa: transiciones de estado", () => {
  it("el diagrama de estados es exactamente el del diseño", () => {
    expect(TRANSICIONES_DE_EMPRESA).toEqual({
      PROVISIONING: ["ACTIVE", "CANCELLED"],
      ACTIVE: ["SUSPENDED", "DELETING"],
      SUSPENDED: ["ACTIVE", "DELETING"],
      CANCELLED: [],
      DELETING: [],
    });
  });

  for (const desde of ESTADOS) {
    for (const hacia of ESTADOS) {
      const permitida = TRANSICIONES_DE_EMPRESA[desde].includes(hacia);
      it(`${desde} → ${hacia}: ${permitida ? "permitida" : "rechazada"}`, () => {
        const r = cambiarEstado(empresa(desde), hacia, "motivo de prueba");
        if (permitida) {
          expect(r.ok).toBe(true);
          expect(r.ok && r.valor.estado).toBe(hacia);
        } else {
          expect(r).toEqual({ ok: false, error: "TRANSICION_NO_PERMITIDA" });
        }
      });
    }
  }

  it("suspender y cancelar exigen motivo; los demás cambios no lo guardan", () => {
    expect(cambiarEstado(empresa("ACTIVE"), "SUSPENDED", null)).toEqual({
      ok: false,
      error: "MOTIVO_OBLIGATORIO",
    });
    expect(cambiarEstado(empresa("ACTIVE"), "SUSPENDED", "   ")).toEqual({
      ok: false,
      error: "MOTIVO_OBLIGATORIO",
    });
    expect(cambiarEstado(empresa("PROVISIONING"), "CANCELLED", "")).toEqual({
      ok: false,
      error: "MOTIVO_OBLIGATORIO",
    });
    expect(cambiarEstado(empresa("ACTIVE"), "SUSPENDED", "  revisión  ")).toEqual({
      ok: true,
      valor: { estado: "SUSPENDED", motivoEstado: "revisión" },
    });
    expect(cambiarEstado(empresa("PROVISIONING"), "ACTIVE", "ignorado")).toEqual({
      ok: true,
      valor: { estado: "ACTIVE", motivoEstado: null },
    });
    expect(cambiarEstado(empresa("SUSPENDED"), "ACTIVE", null)).toEqual({
      ok: true,
      valor: { estado: "ACTIVE", motivoEstado: null },
    });
    expect(cambiarEstado(empresa("ACTIVE"), "DELETING", null)).toEqual({
      ok: true,
      valor: { estado: "DELETING", motivoEstado: null },
    });
  });

  it("razón social y nombre de sucursal se limpian y no pueden quedar vacíos", () => {
    expect(razonSocialValida("  Hotel Sur SA ")).toEqual({ ok: true, valor: "Hotel Sur SA" });
    expect(razonSocialValida(" ")).toEqual({ ok: false, error: "RAZON_SOCIAL_INVALIDA" });
    expect(nombreDeSucursalValido(" Casa central ")).toEqual({ ok: true, valor: "Casa central" });
    expect(nombreDeSucursalValido("")).toEqual({ ok: false, error: "NOMBRE_DE_SUCURSAL_INVALIDO" });
    const s: Sucursal = {
      id: sucursalId("s-1"),
      empresaId: empresaId("e-1"),
      nombre: "x",
      activa: true,
      version: 1,
    };
    expect(s.activa).toBe(true);
  });
});
