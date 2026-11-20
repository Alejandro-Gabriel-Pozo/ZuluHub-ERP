import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "../../src/primitivas/resultado/resultado";

/**
 * Los botones de «Mesas»: salen activos solo si `permisosDelActor` (el mismo cálculo que el guard) incluye `mesas.editar` (Gerente y Administrador). Previene: ofrecer el botón a quien el servidor
 * va a rechazar (un operador), con el módulo en desarrollo o si no se pudieron leer los permisos («todo nace cerrado»). Es solo una ayuda: guardar vuelve a pasar por el guard.
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
const RUTA = "../../apps/web/servidor/modulos";
const puede = async (contexto: never): Promise<boolean> => {
  const modulo = (await import(/* @vite-ignore */ RUTA)) as {
    puedeAdministrarMesas: (c: never) => Promise<boolean>;
  };
  return modulo.puedeAdministrarMesas(contexto);
};
const contexto = () => ({ empresaId: "e-1" }) as never;
const conPermisos = (acciones: string[], activos: string[] = ["salon"]) => {
  mundo.permisos = ok({ acciones, modulos: { activos, enSoloLectura: [] } });
};
beforeEach(() => {
  mundo.fallan = false;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("puedeAdministrarMesas", () => {
  it("con mesas.editar (gerente o administrador): sí", async () => {
    conPermisos(["mesas.ver", "mesas.editar"]);
    expect(await puede(contexto())).toBe(true);
  });
  it("solo con mesas.ver (un operador): no", async () => {
    conPermisos(["mesas.ver"]);
    expect(await puede(contexto())).toBe(false);
  });
  it("con el módulo salon en desarrollo (la acción no figura): no", async () => {
    conPermisos([], []);
    expect(await puede(contexto())).toBe(false);
  });
  it("sin permisos leídos (error o falla): no", async () => {
    mundo.permisos = err("SIN_PERMISO");
    expect(await puede(contexto())).toBe(false);
    mundo.fallan = true;
    expect(await puede(contexto())).toBe(false);
  });
});
