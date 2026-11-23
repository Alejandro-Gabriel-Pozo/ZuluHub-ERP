import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

vi.mock("server-only", () => ({}));

const { exigirAcceso, arrepentirCambioDePlan, asignarPlan, orden } = vi.hoisted(() => ({
  orden: [] as string[],
  exigirAcceso: vi.fn(),
  arrepentirCambioDePlan: vi.fn(),
  asignarPlan: vi.fn(),
}));

vi.mock("../../apps/plataforma/servidor/acceso", () => ({ exigirAcceso }));

import {
  arrepentirCambioDeConsola,
  cambiarPlanDeConsola,
} from "../../apps/plataforma/servidor/acciones-plan";

/**
 * La acción del servidor de «deshacer por arrepentimiento» (frontera entre el navegador y el caso de uso): `exigirAcceso` y el caso van simulados. Se prueba lo que la acción garantiza: autoriza antes de
 * operar, deja pasar la redirección de Next, no deja entrar entradas inválidas, traduce cada rechazo a su texto aprobado y no escribe el pedido en el registro del servidor. También que el cambio de plan
 * dice la falta de anticipación con la primera fecha que mandó el servidor.
 */

const CLAVE = "3f2b8c1e-5d4a-4b7e-9c1a-2e6f8a0b1c3d";
const TENANT = "0190a5c2-7b3e-7c11-8a2d-5f4e3d2c1b0a";
const REDIRECCION = Object.assign(new Error("NEXT_REDIRECT"), {
  digest: "NEXT_REDIRECT;replace;/ingreso;307;",
});
const PEDIDO = {
  claveDeIdempotencia: CLAVE,
  tenantId: TENANT,
  numero: 2,
  numeroEsperado: 2,
  motivo: "  El cliente se arrepintió  ",
};

let registro: MockInstance<(...datos: unknown[]) => void>;

beforeEach(() => {
  orden.length = 0;
  for (const m of [exigirAcceso, arrepentirCambioDePlan, asignarPlan]) m.mockReset();
  exigirAcceso.mockImplementation(() => {
    orden.push("exigirAcceso");
    return Promise.resolve({ casos: { arrepentirCambioDePlan, asignarPlan } });
  });
  arrepentirCambioDePlan.mockImplementation(() => {
    orden.push("arrepentir");
    return Promise.resolve({ ok: true, valor: { numero: 3, repetida: false } });
  });
  registro = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  registro.mockRestore();
});

describe("arrepentirCambioDeConsola", () => {
  it("autoriza antes de operar y le pasa al caso la entrada validada, sin las claves que sobran", async () => {
    const r = await arrepentirCambioDeConsola({ ...PEDIDO, rol: "ADMIN" });
    expect(r).toEqual({ ok: true, dato: { numero: 3 } });
    expect(orden).toEqual(["exigirAcceso", "arrepentir"]);
    expect(arrepentirCambioDePlan).toHaveBeenCalledExactlyOnceWith(PEDIDO);
  });

  it.each([
    ["no es un objeto", "x"],
    ["clave que no es UUID", { ...PEDIDO, claveDeIdempotencia: "abc" }],
    ["cliente que no es UUID", { ...PEDIDO, tenantId: "no" }],
    ["cambio 0", { ...PEDIDO, numero: 0 }],
    ["último visto como texto", { ...PEDIDO, numeroEsperado: "2" }],
  ])("una entrada inválida (%s) no llega al caso ni toca el acceso", async (_n, entrada) => {
    expect(await arrepentirCambioDeConsola(entrada)).toEqual({
      ok: false,
      error: { tipo: "GENERAL", texto: "Los datos no son válidos. Revisalos." },
    });
    expect(exigirAcceso).not.toHaveBeenCalled();
    expect(arrepentirCambioDePlan).not.toHaveBeenCalled();
  });

  it("la redirección de Next (sin sesión) sigue su camino: no se traga", async () => {
    exigirAcceso.mockRejectedValue(REDIRECCION);
    await expect(arrepentirCambioDeConsola(PEDIDO)).rejects.toBe(REDIRECCION);
    expect(arrepentirCambioDePlan).not.toHaveBeenCalled();
  });

  it.each([
    ["PLAZO_VENCIDO", "GENERAL", "Venció el plazo para deshacer este cambio."],
    ["YA_ARREPENTIDO", "GENERAL", "Este cambio ya se deshizo."],
    [
      "NO_ES_EL_ULTIMO_CAMBIO",
      "GENERAL",
      "Hubo un cambio posterior: solo se puede deshacer el último.",
    ],
    ["CAMBIO_SIN_ARREPENTIMIENTO", "GENERAL", "Este cambio no admite arrepentimiento."],
    ["MOTIVO_OBLIGATORIO", "CAMPO", "Escribí el motivo del cambio."],
    [
      "VERSION_DESACTUALIZADA",
      "PANTALLA_VIEJA",
      "Alguien más cambió el plan de este cliente. Recargá la pantalla para ver el estado actual antes de cambiarlo.",
    ],
  ])(
    "el rechazo %s sale con su texto aprobado (T-38: la versión desactualizada, el que el plan ya tenía)",
    async (codigo, tipo, texto) => {
      arrepentirCambioDePlan.mockResolvedValue({ ok: false, error: { codigo } });
      expect(await arrepentirCambioDeConsola(PEDIDO)).toMatchObject({
        ok: false,
        error: { tipo, texto },
      });
    },
  );

  it("sin permiso y sin segundo factor se traducen (la pantalla oculta la acción o pide el código)", async () => {
    arrepentirCambioDePlan.mockResolvedValue({ ok: false, error: "SIN_PERMISO" });
    expect(await arrepentirCambioDeConsola(PEDIDO)).toEqual({
      ok: false,
      error: { tipo: "OCULTAR_ACCION" },
    });
    arrepentirCambioDePlan.mockResolvedValue({
      ok: false,
      error: "segundo_factor_reciente_requerido",
    });
    expect(await arrepentirCambioDeConsola(PEDIDO)).toEqual({
      ok: false,
      error: { tipo: "SEGUNDO_FACTOR" },
    });
  });

  it("lo inesperado sale con referencia y sin el pedido en el registro del servidor", async () => {
    arrepentirCambioDePlan.mockRejectedValue(
      new Error("conexión caída 'El cliente se arrepintió'"),
    );
    const r = await arrepentirCambioDeConsola(PEDIDO);
    expect(r).toMatchObject({ ok: false, error: { tipo: "INESPERADO" } });
    expect(r.ok ? "" : r.referencia).toMatch(/^PD-/);
    expect(JSON.stringify(registro.mock.calls)).not.toContain(CLAVE);
  });
});

describe("cambiarPlanDeConsola: falta de anticipación", () => {
  it("dice la primera fecha posible que mandó el servidor (T-33)", async () => {
    asignarPlan.mockResolvedValue({
      ok: false,
      error: { codigo: "ANTICIPACION_INSUFICIENTE", primeraFechaValida: "2026-12-05" },
    });
    const r = await cambiarPlanDeConsola({
      claveDeIdempotencia: CLAVE,
      tenantId: TENANT,
      versionDePlanId: "11111111-1111-4111-8111-111111111111",
      vigenteDesde: "2026-11-21",
      motivo: "Pasa al plan Pro",
      numeroEsperado: 3,
      reemplazaProgramada: false,
    });
    expect(r).toEqual({
      ok: false,
      error: {
        tipo: "GENERAL",
        texto: "Falta anticipación. La primera fecha posible es el 05/12/2026.",
      },
    });
  });
});
