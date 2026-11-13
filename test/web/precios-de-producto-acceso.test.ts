import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "../../src/primitivas/resultado/resultado";

/**
 * «Guardar» de los precios de un producto: sale activo solo si `permisosDelActor` (el mismo cálculo que el guard) incluye `productos.cambiar_precio` (gerente y administrador).
 * Previene: ofrecer el botón a quien el servidor va a rechazar (un operador), con el módulo en solo lectura (cambiar precio CREA_AMPLIA, la acción no figura) o en desarrollo, o si no
 * se pudieron leer los permisos («todo nace cerrado»). Es solo la ayuda de DEC-0346: cambiar vuelve a pasar por el guard.
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
const puedeCambiarPrecios = async (contexto: never): Promise<boolean> => {
  const modulo = (await import(/* @vite-ignore */ RUTA)) as {
    puedeCambiarPrecios: (c: never) => Promise<boolean>;
  };
  return modulo.puedeCambiarPrecios(contexto);
};

const contexto = () => ({ empresaId: "e-1" }) as never;
const conPermisos = (acciones: string[], activos: string[] = ["catalogo"]) => {
  mundo.permisos = ok({ acciones, modulos: { activos, enSoloLectura: [] } });
};

beforeEach(() => {
  mundo.fallan = false;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("puedeCambiarPrecios", () => {
  it("con productos.cambiar_precio (gerente o administrador): sí", async () => {
    conPermisos(["productos.ver", "productos.cambiar_precio"]);
    expect(await puedeCambiarPrecios(contexto())).toBe(true);
  });

  it("con productos.editar pero sin productos.cambiar_precio: no (son permisos distintos)", async () => {
    conPermisos(["productos.ver", "productos.editar"]);
    expect(await puedeCambiarPrecios(contexto())).toBe(false);
  });

  it("solo con productos.ver (un operador): no", async () => {
    conPermisos(["productos.ver"]);
    expect(await puedeCambiarPrecios(contexto())).toBe(false);
  });

  it("con el módulo en solo lectura o sin activar (la acción no figura): no", async () => {
    mundo.permisos = ok({
      acciones: ["productos.ver"],
      modulos: { activos: [], enSoloLectura: ["catalogo"] },
    });
    expect(await puedeCambiarPrecios(contexto())).toBe(false);
    conPermisos([], []);
    expect(await puedeCambiarPrecios(contexto())).toBe(false);
  });

  it("si no se pudieron leer los permisos (rechazo o excepción): no", async () => {
    mundo.permisos = err({ codigo: "SIN_PERMISO" });
    expect(await puedeCambiarPrecios(contexto())).toBe(false);
    mundo.fallan = true;
    expect(await puedeCambiarPrecios(contexto())).toBe(false);
  });
});
