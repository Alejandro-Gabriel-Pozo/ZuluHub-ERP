import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "../../src/primitivas/resultado/resultado";

/**
 * «Guardar» del alta de un producto: sale activo solo si `permisosDelActor` (el mismo cálculo que el guard) incluye `productos.crear` (gerente y administrador). Previene: ofrecer el
 * botón a quien el servidor va a rechazar (un operador), con el módulo en solo lectura (crear CREA_AMPLIA, la acción no figura) o en desarrollo, o si no se pudieron leer los permisos
 * («todo nace cerrado»). Es solo la ayuda de DEC-0346: crear vuelve a pasar por el guard.
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

// Se carga por una ruta en una variable: la prueba de tipos de `test/` no sigue la importación y no arrastra los componentes del navegador (igual que las otras pruebas de acceso).
const RUTA = "../../apps/web/servidor/modulos";
const puedeCrearProductos = async (contexto: never): Promise<boolean> => {
  const modulo = (await import(/* @vite-ignore */ RUTA)) as {
    puedeCrearProductos: (c: never) => Promise<boolean>;
  };
  return modulo.puedeCrearProductos(contexto);
};

const contexto = () => ({ empresaId: "e-1" }) as never;
const conPermisos = (acciones: string[], activos: string[] = ["catalogo"]) => {
  mundo.permisos = ok({ acciones, modulos: { activos, enSoloLectura: [] } });
};

beforeEach(() => {
  mundo.fallan = false;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("puedeCrearProductos", () => {
  it("con productos.crear (gerente o administrador): sí", async () => {
    conPermisos(["productos.ver", "productos.crear"]);
    expect(await puedeCrearProductos(contexto())).toBe(true);
  });

  it("solo con productos.ver o productos.editar (un operador): no", async () => {
    conPermisos(["productos.ver"]);
    expect(await puedeCrearProductos(contexto())).toBe(false);
    conPermisos(["productos.ver", "productos.editar"]);
    expect(await puedeCrearProductos(contexto())).toBe(false);
  });

  it("con el módulo en solo lectura o sin activar (la acción no figura): no", async () => {
    mundo.permisos = ok({
      acciones: ["productos.ver"],
      modulos: { activos: [], enSoloLectura: ["catalogo"] },
    });
    expect(await puedeCrearProductos(contexto())).toBe(false);
    conPermisos([], []);
    expect(await puedeCrearProductos(contexto())).toBe(false);
  });

  it("si no se pudieron leer los permisos (rechazo o excepción): no", async () => {
    mundo.permisos = err({ codigo: "SIN_PERMISO" });
    expect(await puedeCrearProductos(contexto())).toBe(false);
    mundo.fallan = true;
    expect(await puedeCrearProductos(contexto())).toBe(false);
  });
});
