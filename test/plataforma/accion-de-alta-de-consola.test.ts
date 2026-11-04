import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

vi.mock("server-only", () => ({}));

const { exigirAcceso, altaDeEmpresa, orden } = vi.hoisted(() => {
  const orden: string[] = [];
  return {
    orden,
    altaDeEmpresa: vi.fn(),
    exigirAcceso: vi.fn(),
  };
});

vi.mock("../../apps/plataforma/servidor/acceso", () => ({ exigirAcceso }));

import { altaDeEmpresaDeConsola } from "../../apps/plataforma/servidor/acciones-empresas";

/**
 * La acción del servidor del alta (la frontera entre el navegador y el caso de uso): `exigirAcceso` y el caso de
 * uso van simulados. Se prueba lo que la acción garantiza: autoriza antes de operar, deja pasar la redirección de
 * Next, no deja entrar entradas inválidas y no escribe el pedido (CUIT, email) en el registro del servidor.
 */

const CUIT = "30712345671";
const EMAIL = "gerente@laespiga.com.ar";

const ENTRADA = {
  claveDeIdempotencia: "3f2b8c1e-5d4a-4b7e-9c1a-2e6f8a0b1c3d",
  razonSocial: "Panadería La Espiga S.A.",
  cuit: CUIT,
  marcaId: "0190a5c2-7b3e-7c11-8a2d-5f4e3d2c1b0a",
  versionDePlanId: null,
  emailGerente: EMAIL,
  zonaHoraria: "America/Argentina/Buenos_Aires",
};

let registro: MockInstance<(...datos: unknown[]) => void>;

beforeEach(() => {
  orden.length = 0;
  exigirAcceso.mockReset();
  altaDeEmpresa.mockReset();
  exigirAcceso.mockImplementation(() => {
    orden.push("exigirAcceso");
    return Promise.resolve({ casos: { altaDeEmpresa } });
  });
  altaDeEmpresa.mockImplementation(() => {
    orden.push("altaDeEmpresa");
    return Promise.resolve({ ok: true, valor: { empresaId: "e-1", yaExistia: false } });
  });
  registro = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  registro.mockRestore();
});

describe("altaDeEmpresaDeConsola", () => {
  it("camino feliz: autoriza primero, llama al caso con la clave del navegador y devuelve el dato", async () => {
    const r = await altaDeEmpresaDeConsola(ENTRADA);
    expect(r).toEqual({ ok: true, dato: { empresaId: "e-1", yaExistia: false } });
    expect(orden).toEqual(["exigirAcceso", "altaDeEmpresa"]);
    expect(altaDeEmpresa).toHaveBeenCalledWith(
      expect.objectContaining({ claveDeIdempotencia: ENTRADA.claveDeIdempotencia, moneda: "ARS" }),
    );
  });

  it("`exigirAcceso` corre antes del caso de uso: si no hay acceso, el caso no corre", async () => {
    const redireccion = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/ingreso;307;",
    });
    exigirAcceso.mockImplementation(() => {
      orden.push("exigirAcceso");
      return Promise.reject(redireccion);
    });
    await expect(altaDeEmpresaDeConsola(ENTRADA)).rejects.toBe(redireccion);
    expect(orden).toEqual(["exigirAcceso"]);
    expect(altaDeEmpresa).not.toHaveBeenCalled();
  });

  it("NEXT_REDIRECT se relanza tal cual y no se registra como falla", async () => {
    const redireccion = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/ingreso/codigo;307;",
    });
    exigirAcceso.mockRejectedValue(redireccion);
    await expect(altaDeEmpresaDeConsola(ENTRADA)).rejects.toBe(redireccion);
    expect(registro).not.toHaveBeenCalled();
  });

  it("un error con digest que NO es de redirección se traduce a INESPERADO con referencia", async () => {
    exigirAcceso.mockRejectedValue(Object.assign(new Error("otra cosa"), { digest: "OTRO;x" }));
    const r = await altaDeEmpresaDeConsola(ENTRADA);
    expect(r).toMatchObject({ ok: false, error: { tipo: "INESPERADO" } });
    expect(r.ok === false && r.referencia).toMatch(/^PD-/);
  });

  it.each([null, undefined, "texto", [], { ...ENTRADA, claveDeIdempotencia: "no-es-uuid" }])(
    "entrada inválida (%j): responde datos no válidos y no llama a nada",
    async (entrada) => {
      const r = await altaDeEmpresaDeConsola(entrada);
      expect(r).toEqual({
        ok: false,
        error: { tipo: "GENERAL", texto: "Los datos no son válidos. Revisalos." },
      });
      expect(exigirAcceso).not.toHaveBeenCalled();
      expect(altaDeEmpresa).not.toHaveBeenCalled();
    },
  );

  it("una falla inesperada del caso de uso: referencia PD-… y el registro no contiene CUIT ni email", async () => {
    altaDeEmpresa.mockRejectedValue(new Error("se cayó la conexión"));
    const r = await altaDeEmpresaDeConsola(ENTRADA);
    expect(r).toMatchObject({ ok: false, error: { tipo: "INESPERADO" } });
    expect(registro).toHaveBeenCalledTimes(1);
    const escrito = JSON.stringify(registro.mock.calls);
    expect(escrito).toContain("se cayó la conexión");
    expect(escrito).not.toContain(CUIT);
    expect(escrito).not.toContain("30-71234567-1");
    expect(escrito).not.toContain(EMAIL);
    expect(escrito).not.toContain("La Espiga");
    // Lo que sale hacia el navegador tampoco lleva el pedido.
    expect(JSON.stringify(r)).not.toContain(EMAIL);
  });

  it("un error inesperado devuelto como valor (no excepción) también se registra sin el pedido", async () => {
    altaDeEmpresa.mockResolvedValue({ ok: false, error: { tipo: "Inesperado", mensaje: "falla" } });
    const r = await altaDeEmpresaDeConsola(ENTRADA);
    expect(r).toMatchObject({ ok: false, error: { tipo: "INESPERADO" } });
    const escrito = JSON.stringify(registro.mock.calls);
    expect(escrito).not.toContain(CUIT);
    expect(escrito).not.toContain(EMAIL);
  });

  it("un rechazo de negocio se traduce y no se registra", async () => {
    altaDeEmpresa.mockResolvedValue({ ok: false, error: "CUIT_DUPLICADO" });
    const r = await altaDeEmpresaDeConsola(ENTRADA);
    expect(r).toMatchObject({ ok: false, error: { tipo: "CAMPO", campo: "cuit" } });
    expect(registro).not.toHaveBeenCalled();
  });
});
