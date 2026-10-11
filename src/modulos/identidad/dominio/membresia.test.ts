import { describe, expect, it } from "vitest";
import { empresaId, personaId } from "../../../primitivas/identificadores/marca";
import {
  decidirApagado,
  puedeAdministrarAccesos,
  type Membresia,
  type RolDeEmpresa,
} from "./membresia";

const EMPRESA = empresaId("e-1");

const membresia = (
  persona: string,
  rol: RolDeEmpresa,
  activo = true,
  empresa = EMPRESA,
): Membresia => ({ empresaId: empresa, personaId: personaId(persona), rol, activo, version: 1 });

const gerente = membresia("p-gerente", "GERENTE");
const admin = membresia("p-admin", "ADMINISTRADOR");
const operador = membresia("p-operador", "OPERADOR");

describe("decidirApagado", () => {
  it("una membresía que no existe es MEMBRESIA_NO_ENCONTRADA", () => {
    expect(decidirApagado(null, [gerente, admin])).toEqual({
      ok: false,
      error: "MEMBRESIA_NO_ENCONTRADA",
    });
  });

  it("apagar lo ya apagado es ok y no escribe (idempotente), sea cual sea el rol", () => {
    for (const rol of ["GERENTE", "ADMINISTRADOR", "OPERADOR"] as const) {
      const apagada = membresia("p-x", rol, false);
      expect(decidirApagado(apagada, [])).toEqual({ ok: true, valor: "YA_APAGADA" });
      expect(decidirApagado(apagada, [gerente])).toEqual({ ok: true, valor: "YA_APAGADA" });
    }
  });

  it("el gerente activo no se apaga: se traspasa (aunque haya otros admins)", () => {
    expect(decidirApagado(gerente, [gerente, admin])).toEqual({
      ok: false,
      error: "ES_EL_GERENTE",
    });
    expect(decidirApagado(gerente, [])).toEqual({ ok: false, error: "ES_EL_GERENTE" });
  });

  it("el último admin activo no se apaga", () => {
    expect(decidirApagado(admin, [admin])).toEqual({ ok: false, error: "ULTIMO_ADMIN" });
    expect(decidirApagado(admin, [admin, operador])).toEqual({ ok: false, error: "ULTIMO_ADMIN" });
    expect(decidirApagado(admin, [])).toEqual({ ok: false, error: "ULTIMO_ADMIN" });
  });

  it("con otro admin activo en la empresa, el administrador se apaga", () => {
    const otroAdmin = membresia("p-admin-2", "ADMINISTRADOR");
    expect(decidirApagado(admin, [admin, otroAdmin])).toEqual({ ok: true, valor: "APAGAR" });
    expect(decidirApagado(admin, [admin, gerente])).toEqual({ ok: true, valor: "APAGAR" });
    expect(decidirApagado(admin, [gerente])).toEqual({ ok: true, valor: "APAGAR" });
  });

  it("un operador se apaga siempre, aun siendo el único activo", () => {
    expect(decidirApagado(operador, [operador])).toEqual({ ok: true, valor: "APAGAR" });
    expect(decidirApagado(operador, [])).toEqual({ ok: true, valor: "APAGAR" });
  });

  it("el objetivo no se cuenta a sí mismo, venga o no dentro de las activas", () => {
    expect(decidirApagado(admin, [admin])).toEqual({ ok: false, error: "ULTIMO_ADMIN" });
    expect(decidirApagado(admin, [])).toEqual({ ok: false, error: "ULTIMO_ADMIN" });
  });

  it("los admins inactivos o de otra empresa no cuentan como admin que queda", () => {
    const adminApagado = membresia("p-admin-2", "ADMINISTRADOR", false);
    const gerenteApagado = membresia("p-gerente-2", "GERENTE", false);
    const adminDeOtra = membresia("p-admin-3", "ADMINISTRADOR", true, empresaId("e-2"));
    const gerenteDeOtra = membresia("p-gerente-3", "GERENTE", true, empresaId("e-2"));
    expect(
      decidirApagado(admin, [admin, adminApagado, gerenteApagado, adminDeOtra, gerenteDeOtra]),
    ).toEqual({ ok: false, error: "ULTIMO_ADMIN" });
  });

  it("un operador activo no es admin: no cuenta como admin que queda", () => {
    expect(decidirApagado(admin, [admin, operador, membresia("p-op-2", "OPERADOR")])).toEqual({
      ok: false,
      error: "ULTIMO_ADMIN",
    });
  });

  it("la misma persona con el mismo id en otra empresa no cuenta como el objetivo", () => {
    const mismaPersonaEnOtra = membresia("p-admin", "ADMINISTRADOR", true, empresaId("e-2"));
    expect(decidirApagado(admin, [admin, mismaPersonaEnOtra])).toEqual({
      ok: false,
      error: "ULTIMO_ADMIN",
    });
  });
});

describe("puedeAdministrarAccesos (control de piso transitorio)", () => {
  it("el gerente y el administrador activos pueden", () => {
    expect(puedeAdministrarAccesos(gerente)).toBe(true);
    expect(puedeAdministrarAccesos(admin)).toBe(true);
  });

  it("el operador no puede", () => {
    expect(puedeAdministrarAccesos(operador)).toBe(false);
  });

  it("quien está apagado no puede, sea cual sea su rol", () => {
    for (const rol of ["GERENTE", "ADMINISTRADOR", "OPERADOR"] as const) {
      expect(puedeAdministrarAccesos(membresia("p-x", rol, false))).toBe(false);
    }
  });

  it("quien no es miembro no puede", () => {
    expect(puedeAdministrarAccesos(null)).toBe(false);
  });
});
