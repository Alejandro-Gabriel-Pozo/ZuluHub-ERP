import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

vi.mock("server-only", () => ({}));

const { exigirAcceso, guardarBorradorDeMarca, confirmarVersionDeMarca } = vi.hoisted(() => ({
  exigirAcceso: vi.fn(),
  guardarBorradorDeMarca: vi.fn(),
  confirmarVersionDeMarca: vi.fn(),
}));

vi.mock("../../apps/plataforma/servidor/acceso", () => ({ exigirAcceso }));

import {
  confirmarVersionDeSubmarcaDeConsola,
  guardarBorradorDeSubmarcaDeConsola,
} from "../../apps/plataforma/servidor/acciones-submarcas";

/**
 * Las acciones del servidor de la pantalla Submarca (la frontera entre el navegador y los casos de uso):
 * `exigirAcceso` y los casos van simulados. Se prueba lo que la acción garantiza: pasa la clave del navegador
 * tal cual, traduce los errores con el contexto de submarca, relanza la redirección de Next y no deja entrar
 * entradas inválidas.
 */

const CLAVE = "3f2b8c1e-5d4a-4b7e-9c1a-2e6f8a0b1c3d";
const MARCA = "0190a5c2-7b3e-7c11-8a2d-5f4e3d2c1b0a";

const BORRADOR = {
  claveDeIdempotencia: CLAVE,
  marcaId: MARCA,
  versionEsperada: 3,
  cambios: { tema: { accent: "#0f766e" }, aspecto: { esquinas: "RECTA" } },
};
const CONFIRMACION = {
  claveDeIdempotencia: CLAVE,
  marcaId: MARCA,
  vigenteDesde: "2026-11-02",
  motivo: "Cambio de imagen",
  reemplazaProgramada: false,
};

const redireccion = () =>
  Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/ingreso;307;" });

let registro: MockInstance<(...datos: unknown[]) => void>;

beforeEach(() => {
  exigirAcceso.mockReset();
  guardarBorradorDeMarca.mockReset();
  confirmarVersionDeMarca.mockReset();
  exigirAcceso.mockResolvedValue({ casos: { guardarBorradorDeMarca, confirmarVersionDeMarca } });
  guardarBorradorDeMarca.mockResolvedValue({ ok: true, valor: { version: 4 } });
  confirmarVersionDeMarca.mockResolvedValue({ ok: true, valor: { numero: 2 } });
  registro = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  registro.mockRestore();
});

describe("guardarBorradorDeSubmarcaDeConsola", () => {
  it("camino feliz: manda al caso la clave, la versión esperada y solo los cambios (aspecto parcial)", async () => {
    const r = await guardarBorradorDeSubmarcaDeConsola(BORRADOR);
    expect(r).toEqual({ ok: true, dato: { version: 4 } });
    expect(guardarBorradorDeMarca).toHaveBeenCalledWith({
      claveDeIdempotencia: CLAVE,
      marcaId: MARCA,
      versionEsperada: 3,
      tema: { accent: "#0f766e" },
      aspecto: { esquinas: "RECTA" },
    });
  });

  it("conflicto de versión: pantalla vieja con el texto de «alguien más cambió el borrador»", async () => {
    guardarBorradorDeMarca.mockResolvedValue({ ok: false, error: "VERSION_DESACTUALIZADA" });
    const r = await guardarBorradorDeSubmarcaDeConsola(BORRADOR);
    expect(r).toMatchObject({ ok: false, error: { tipo: "PANTALLA_VIEJA" } });
    expect(JSON.stringify(r)).toContain("Alguien más cambió el borrador");
    expect(JSON.stringify(r)).not.toContain("VERSION_DESACTUALIZADA");
  });

  it("segundo factor: la puerta lo pide y la acción lo devuelve tal cual, sin registrar una falla", async () => {
    guardarBorradorDeMarca.mockResolvedValue({
      ok: false,
      error: "segundo_factor_reciente_requerido",
    });
    expect(await guardarBorradorDeSubmarcaDeConsola(BORRADOR)).toEqual({
      ok: false,
      error: { tipo: "SEGUNDO_FACTOR" },
    });
    expect(registro).not.toHaveBeenCalled();
  });

  it("reintento y doble toque: la MISMA clave llega al caso las dos veces y el resultado es el mismo", async () => {
    const [a, b] = await Promise.all([
      guardarBorradorDeSubmarcaDeConsola(BORRADOR),
      guardarBorradorDeSubmarcaDeConsola(BORRADOR),
    ]);
    expect(a).toEqual(b);
    const claves = guardarBorradorDeMarca.mock.calls.map(
      ([pedido]) => (pedido as { claveDeIdempotencia: string }).claveDeIdempotencia,
    );
    expect(claves).toEqual([CLAVE, CLAVE]);
  });

  it("NEXT_REDIRECT se relanza tal cual y no se registra como falla", async () => {
    const r = redireccion();
    exigirAcceso.mockRejectedValue(r);
    await expect(guardarBorradorDeSubmarcaDeConsola(BORRADOR)).rejects.toBe(r);
    expect(guardarBorradorDeMarca).not.toHaveBeenCalled();
    expect(registro).not.toHaveBeenCalled();
  });

  it("NEXT_REDIRECT lanzado por el caso de uso también se relanza", async () => {
    const r = redireccion();
    guardarBorradorDeMarca.mockRejectedValue(r);
    await expect(guardarBorradorDeSubmarcaDeConsola(BORRADOR)).rejects.toBe(r);
  });

  it("una excepción común es INESPERADO con referencia y sin el detalle hacia afuera", async () => {
    guardarBorradorDeMarca.mockRejectedValue(new Error("fallo interno con datos"));
    const r = await guardarBorradorDeSubmarcaDeConsola(BORRADOR);
    expect(r).toMatchObject({ ok: false, error: { tipo: "INESPERADO" } });
    expect(JSON.stringify(r)).not.toContain("fallo interno");
    expect(registro).toHaveBeenCalled();
  });

  it("una entrada inválida no llega ni a pedir acceso", async () => {
    const r = await guardarBorradorDeSubmarcaDeConsola({ ...BORRADOR, claveDeIdempotencia: "x" });
    expect(r).toMatchObject({ ok: false, error: { tipo: "GENERAL" } });
    expect(exigirAcceso).not.toHaveBeenCalled();
  });
});

describe("confirmarVersionDeSubmarcaDeConsola", () => {
  it("camino feliz: convierte la fecha y pasa la clave del navegador", async () => {
    const r = await confirmarVersionDeSubmarcaDeConsola(CONFIRMACION);
    expect(r).toEqual({ ok: true, dato: { numero: 2 } });
    const pedido = confirmarVersionDeMarca.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(pedido).toMatchObject({
      claveDeIdempotencia: CLAVE,
      marcaId: MARCA,
      motivo: "Cambio de imagen",
      reemplazaProgramada: false,
    });
    expect(pedido["vigenteDesde"]).toBeInstanceOf(Date);
  });

  it("segundo factor: se devuelve para que la pantalla pida el código y repita con la misma clave", async () => {
    confirmarVersionDeMarca
      .mockResolvedValueOnce({ ok: false, error: "segundo_factor_reciente_requerido" })
      .mockResolvedValueOnce({ ok: true, valor: { numero: 2 } });
    const primera = await confirmarVersionDeSubmarcaDeConsola(CONFIRMACION);
    const segunda = await confirmarVersionDeSubmarcaDeConsola(CONFIRMACION);
    expect(primera).toEqual({ ok: false, error: { tipo: "SEGUNDO_FACTOR" } });
    expect(segunda).toEqual({ ok: true, dato: { numero: 2 } });
    const claves = confirmarVersionDeMarca.mock.calls.map(
      ([pedido]) => (pedido as { claveDeIdempotencia: string }).claveDeIdempotencia,
    );
    expect(claves).toEqual([CLAVE, CLAVE]);
  });

  it("cambio programado que la pantalla no mostraba: pantalla vieja (con «Recargar»)", async () => {
    confirmarVersionDeMarca.mockResolvedValue({ ok: false, error: "CAMBIO_PROGRAMADO_PENDIENTE" });
    const r = await confirmarVersionDeSubmarcaDeConsola(CONFIRMACION);
    expect(r).toMatchObject({ ok: false, error: { tipo: "PANTALLA_VIEJA" } });
  });

  it("submarca retirada: su propio error, no «pantalla vieja»", async () => {
    confirmarVersionDeMarca.mockResolvedValue({ ok: false, error: "MARCA_RETIRADA" });
    const r = await confirmarVersionDeSubmarcaDeConsola(CONFIRMACION);
    expect(r).toMatchObject({ ok: false, error: { tipo: "MARCA_RETIRADA" } });
  });

  it("NEXT_REDIRECT se relanza tal cual", async () => {
    const r = redireccion();
    exigirAcceso.mockRejectedValue(r);
    await expect(confirmarVersionDeSubmarcaDeConsola(CONFIRMACION)).rejects.toBe(r);
    expect(registro).not.toHaveBeenCalled();
  });

  it("una fecha imposible no llega a pedir acceso", async () => {
    const r = await confirmarVersionDeSubmarcaDeConsola({
      ...CONFIRMACION,
      vigenteDesde: "2026-13-45",
    });
    expect(r).toMatchObject({ ok: false, error: { tipo: "GENERAL" } });
    expect(exigirAcceso).not.toHaveBeenCalled();
  });
});
