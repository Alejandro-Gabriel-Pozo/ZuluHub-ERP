import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "../../src/primitivas/resultado/resultado";

/**
 * Los botones de Stock: «Agregar depósito» sale activo solo si `permisosDelActor` (el mismo cálculo que el guard) incluye SU acción. Previene: ofrecer el botón a quien el servidor va a rechazar
 * (un operador que solo mira), con el módulo apagado o si no se pudieron leer los permisos («todo nace cerrado»). Es solo una ayuda: la acción vuelve a pasar por el guard.
 */
vi.mock("server-only", () => ({}));
const mundo = vi.hoisted((): { permisos: unknown; fallan: boolean } => ({
  permisos: null,
  fallan: false,
}));
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    consultasDeEmpresas: () => ({
      permisosDelActor: () =>
        mundo.fallan
          ? Promise.reject(new Error("la base no responde"))
          : Promise.resolve(mundo.permisos),
    }),
  },
}));
const RUTA = "../../apps/web/servidor/ofertas-de-stock";
type Puede = (contexto: never, accion: string) => Promise<boolean>;
const cargar = async () =>
  (await import(/* @vite-ignore */ RUTA)) as unknown as { puedeEnStock: Puede };
const contexto = () => ({ empresaId: "e-1" }) as never;
const conPermisos = (acciones: string[], activos: string[] = ["stock"]) => {
  mundo.permisos = ok({ acciones, modulos: { activos, enSoloLectura: [] } });
};
beforeEach(() => {
  mundo.fallan = false;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("puedeEnStock", () => {
  it("con la acción pedida y el módulo activo: sí", async () => {
    conPermisos(["stock.ver", "depositos.crear"]);
    expect(await (await cargar()).puedeEnStock(contexto(), "depositos.crear")).toBe(true);
  });
  it("quien solo mira (stock.ver) no puede agregar depósitos", async () => {
    conPermisos(["stock.ver"]);
    const { puedeEnStock } = await cargar();
    expect(await puedeEnStock(contexto(), "depositos.crear")).toBe(false);
    expect(await puedeEnStock(contexto(), "stock.ver")).toBe(true);
  });
  it("con el módulo apagado (la acción no figura entre las del actor): no", async () => {
    conPermisos([], []);
    expect(await (await cargar()).puedeEnStock(contexto(), "depositos.crear")).toBe(false);
  });
  it("sin permisos leídos (error o falla): no", async () => {
    mundo.permisos = err("SIN_PERMISO");
    expect(await (await cargar()).puedeEnStock(contexto(), "depositos.crear")).toBe(false);
    mundo.fallan = true;
    expect(await (await cargar()).puedeEnStock(contexto(), "depositos.crear")).toBe(false);
  });
});
