import { describe, expect, it } from "vitest";
import { empresaId, personaId } from "../../../primitivas/identificadores/marca";
import { decidirApagado, type Membresia, type RolDeLaMembresia } from "./membresia";

const EMPRESA = empresaId("e-1");

const membresia = (
  persona: string,
  rol: RolDeLaMembresia,
  activo = true,
  empresa = EMPRESA,
): Membresia => ({
  empresaId: empresa,
  personaId: personaId(persona),
  rol,
  rolPropioId: null,
  activo,
  version: 1,
});

/** La persona que pide el apagado: ninguna de las del escenario, salvo en las pruebas de `ES_UNO_MISMO`. */
const QUIEN_PIDE = personaId("p-quien-pide");

const gerente = membresia("p-gerente", "GERENTE");
const admin = membresia("p-admin", "ADMINISTRADOR");
const operador = membresia("p-operador", "OPERADOR");

describe("decidirApagado con un rol propio (T4 de H4b)", () => {
  const propio = membresia("p-propio", "PROPIO");

  it("una persona con rol propio se apaga como cualquier no administrador", () => {
    expect(decidirApagado(propio, [gerente, propio], QUIEN_PIDE)).toEqual({
      ok: true,
      valor: "APAGAR",
    });
  });

  it("un rol propio NO cuenta como administrador: no evita que el último administrador sea el último (con gerente activo nunca queda sin admin)", () => {
    expect(decidirApagado(admin, [admin, propio], QUIEN_PIDE)).toEqual({
      ok: false,
      error: "ULTIMO_ADMIN",
    });
    expect(decidirApagado(admin, [admin, propio, gerente], QUIEN_PIDE)).toEqual({
      ok: true,
      valor: "APAGAR",
    });
  });
});

describe("decidirApagado", () => {
  it("una membresía que no existe es MEMBRESIA_NO_ENCONTRADA", () => {
    expect(decidirApagado(null, [gerente, admin], QUIEN_PIDE)).toEqual({
      ok: false,
      error: "MEMBRESIA_NO_ENCONTRADA",
    });
  });

  it("nadie se apaga a sí mismo: ES_UNO_MISMO, sea cual sea su rol y aunque haya otros admins", () => {
    for (const objetivo of [gerente, admin, operador]) {
      expect(decidirApagado(objetivo, [gerente, admin, operador], objetivo.personaId)).toEqual({
        ok: false,
        error: "ES_UNO_MISMO",
      });
    }
  });

  it("el actor solo importa si es el objetivo: otro admin sí puede apagar a un administrador", () => {
    const otroAdmin = membresia("p-admin-2", "ADMINISTRADOR");
    expect(decidirApagado(admin, [admin, otroAdmin], otroAdmin.personaId)).toEqual({
      ok: true,
      valor: "APAGAR",
    });
    expect(decidirApagado(operador, [operador], admin.personaId)).toEqual({
      ok: true,
      valor: "APAGAR",
    });
  });

  it("apagar lo ya apagado es ok y no escribe (idempotente), sea cual sea el rol", () => {
    for (const rol of ["GERENTE", "ADMINISTRADOR", "OPERADOR"] as const) {
      const apagada = membresia("p-x", rol, false);
      expect(decidirApagado(apagada, [], QUIEN_PIDE)).toEqual({ ok: true, valor: "YA_APAGADA" });
      expect(decidirApagado(apagada, [gerente], QUIEN_PIDE)).toEqual({
        ok: true,
        valor: "YA_APAGADA",
      });
    }
  });

  it("el gerente activo no se apaga: se traspasa (aunque haya otros admins)", () => {
    expect(decidirApagado(gerente, [gerente, admin], QUIEN_PIDE)).toEqual({
      ok: false,
      error: "ES_EL_GERENTE",
    });
    expect(decidirApagado(gerente, [], QUIEN_PIDE)).toEqual({ ok: false, error: "ES_EL_GERENTE" });
  });

  it("el último admin activo no se apaga", () => {
    expect(decidirApagado(admin, [admin], QUIEN_PIDE)).toEqual({
      ok: false,
      error: "ULTIMO_ADMIN",
    });
    expect(decidirApagado(admin, [admin, operador], QUIEN_PIDE)).toEqual({
      ok: false,
      error: "ULTIMO_ADMIN",
    });
    expect(decidirApagado(admin, [], QUIEN_PIDE)).toEqual({ ok: false, error: "ULTIMO_ADMIN" });
  });

  it("con otro admin activo en la empresa, el administrador se apaga", () => {
    const otroAdmin = membresia("p-admin-2", "ADMINISTRADOR");
    expect(decidirApagado(admin, [admin, otroAdmin], QUIEN_PIDE)).toEqual({
      ok: true,
      valor: "APAGAR",
    });
    expect(decidirApagado(admin, [admin, gerente], QUIEN_PIDE)).toEqual({
      ok: true,
      valor: "APAGAR",
    });
    expect(decidirApagado(admin, [gerente], QUIEN_PIDE)).toEqual({ ok: true, valor: "APAGAR" });
  });

  it("un operador se apaga siempre, aun siendo el único activo", () => {
    expect(decidirApagado(operador, [operador], QUIEN_PIDE)).toEqual({ ok: true, valor: "APAGAR" });
    expect(decidirApagado(operador, [], QUIEN_PIDE)).toEqual({ ok: true, valor: "APAGAR" });
  });

  it("el objetivo no se cuenta a sí mismo, venga o no dentro de las activas", () => {
    expect(decidirApagado(admin, [admin], QUIEN_PIDE)).toEqual({
      ok: false,
      error: "ULTIMO_ADMIN",
    });
    expect(decidirApagado(admin, [], QUIEN_PIDE)).toEqual({ ok: false, error: "ULTIMO_ADMIN" });
  });

  it("los admins inactivos o de otra empresa no cuentan como admin que queda", () => {
    const adminApagado = membresia("p-admin-2", "ADMINISTRADOR", false);
    const gerenteApagado = membresia("p-gerente-2", "GERENTE", false);
    const adminDeOtra = membresia("p-admin-3", "ADMINISTRADOR", true, empresaId("e-2"));
    const gerenteDeOtra = membresia("p-gerente-3", "GERENTE", true, empresaId("e-2"));
    expect(
      decidirApagado(
        admin,
        [admin, adminApagado, gerenteApagado, adminDeOtra, gerenteDeOtra],
        QUIEN_PIDE,
      ),
    ).toEqual({ ok: false, error: "ULTIMO_ADMIN" });
  });

  it("un operador activo no es admin: no cuenta como admin que queda", () => {
    expect(
      decidirApagado(admin, [admin, operador, membresia("p-op-2", "OPERADOR")], QUIEN_PIDE),
    ).toEqual({
      ok: false,
      error: "ULTIMO_ADMIN",
    });
  });

  it("la misma persona con el mismo id en otra empresa no cuenta como el objetivo", () => {
    const mismaPersonaEnOtra = membresia("p-admin", "ADMINISTRADOR", true, empresaId("e-2"));
    expect(decidirApagado(admin, [admin, mismaPersonaEnOtra], QUIEN_PIDE)).toEqual({
      ok: false,
      error: "ULTIMO_ADMIN",
    });
  });
});
