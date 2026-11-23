import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { exigirAcceso, listarValoresDeLista } = vi.hoisted(() => ({
  exigirAcceso: vi.fn(),
  listarValoresDeLista: vi.fn(),
}));

vi.mock("../../apps/plataforma/servidor/acceso", () => ({ exigirAcceso }));

import { resumenDeListas, valoresDeLaLista } from "../../apps/plataforma/servidor/listas";

/**
 * Las lecturas de la pantalla Listas: `exigirAcceso` y la consulta van simuladas. Se prueba lo que la lectura garantiza: pide solo la lista que existe en la tabla de
 * la consola, entrega solo lo que la pantalla muestra, deja la fija al final, dice si quien mira puede cambiar la lista según su rol y traduce los errores.
 */

const valor = (id: string, nombre: string, extra: Record<string, unknown> = {}) => ({
  id,
  lista: "MARCAS_DE_TARJETA",
  nombre,
  activo: true,
  fija: false,
  version: 2,
  actualizadoEn: new Date("2026-11-01T00:00:00Z"),
  ...extra,
});

const acceso = (rol: "ADMIN" | "SOPORTE") => ({
  admin: { id: "a1", rol },
  consultas: { listarValoresDeLista },
});

beforeEach(() => {
  exigirAcceso.mockReset();
  listarValoresDeLista.mockReset();
  exigirAcceso.mockResolvedValue(acceso("ADMIN"));
  listarValoresDeLista.mockResolvedValue({
    ok: true,
    valor: {
      valores: [
        valor("v1", "Otra", { fija: true }),
        valor("v2", "Cabal"),
        valor("v3", "Visa", { activo: false }),
        valor("v4", "Motivo", { lista: "MOTIVOS_DE_RECHAZO" }),
      ],
    },
  });
});

describe("valoresDeLaLista", () => {
  it("pide la lista del dominio, entrega solo lo que se ve y deja la fija al final", async () => {
    const r = await valoresDeLaLista("marcas");
    expect(listarValoresDeLista).toHaveBeenCalledWith({ lista: "MARCAS_DE_TARJETA" });
    expect(r).toEqual({
      ok: true,
      lista: { nombre: "marcas", lista: "MARCAS_DE_TARJETA", titulo: "Marcas de tarjeta" },
      valores: [
        { id: "v2", nombre: "Cabal", activo: true, fija: false, version: 2 },
        { id: "v3", nombre: "Visa", activo: false, fija: false, version: 2 },
        { id: "v4", nombre: "Motivo", activo: true, fija: false, version: 2 },
        { id: "v1", nombre: "Otra", activo: true, fija: true, version: 2 },
      ],
      puedeEditar: true,
    });
  });

  it("el administrador puede editar y soporte solo mira (una ayuda: el guard decide al enviar)", async () => {
    exigirAcceso.mockResolvedValue(acceso("SOPORTE"));
    expect(await valoresDeLaLista("marcas")).toMatchObject({ ok: true, puedeEditar: false });
  });

  it.each(["", "otra", "MARCAS_DE_TARJETA", "constructor"])(
    "un nombre %j que no es una lista da null y no consulta ni pide acceso",
    async (nombre) => {
      expect(await valoresDeLaLista(nombre)).toBeNull();
      expect(exigirAcceso).not.toHaveBeenCalled();
      expect(listarValoresDeLista).not.toHaveBeenCalled();
    },
  );

  it("sin permiso para ver: la acción se oculta; lo desconocido es inesperado con referencia", async () => {
    listarValoresDeLista.mockResolvedValue({ ok: false, error: "SIN_PERMISO" });
    expect(await valoresDeLaLista("marcas")).toEqual({
      ok: false,
      error: { tipo: "OCULTAR_ACCION" },
    });
    const registro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    listarValoresDeLista.mockRejectedValue(new Error("detalle interno"));
    const r = await valoresDeLaLista("marcas");
    expect(r).toMatchObject({ ok: false, error: { tipo: "INESPERADO" } });
    expect(JSON.stringify(r)).not.toContain("detalle interno");
    registro.mockRestore();
  });
});

describe("resumenDeListas", () => {
  it("cuenta solo los valores activos de cada lista de la consola", async () => {
    expect(await resumenDeListas()).toEqual({
      ok: true,
      listas: [{ nombre: "marcas", titulo: "Marcas de tarjeta", activos: 2 }],
    });
    expect(listarValoresDeLista).toHaveBeenCalledWith({});
  });

  it("sin permiso para ver, se oculta", async () => {
    listarValoresDeLista.mockResolvedValue({ ok: false, error: "SIN_PERMISO" });
    expect(await resumenDeListas()).toEqual({ ok: false, error: { tipo: "OCULTAR_ACCION" } });
  });
});
