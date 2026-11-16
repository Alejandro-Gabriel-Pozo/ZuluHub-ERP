import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "../../src/primitivas/resultado/resultado";

/**
 * «Nueva receta», «Editar», «Agregar ingrediente», «Quitar» y «Guardar» de Recetas: salen activos solo si `permisosDelActor` (el mismo cálculo que el guard) incluye `composiciones.editar`
 * (gerente y administrador). Previene: ofrecer el botón a quien el servidor va a rechazar (un operador, que solo ve), con el módulo en solo lectura (la acción no figura) o en desarrollo, o si no se
 * pudieron leer los permisos («todo nace cerrado»). Es solo la ayuda: guardar vuelve a pasar por el guard, con alcance de todas las sucursales (B8 de `recetas-pantalla.md`).
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
const puedeEditarRecetas = async (contexto: never): Promise<boolean> => {
  const modulo = (await import(/* @vite-ignore */ RUTA)) as {
    puedeEditarRecetas: (c: never) => Promise<boolean>;
  };
  return modulo.puedeEditarRecetas(contexto);
};

const contexto = () => ({ empresaId: "e-1" }) as never;
const conPermisos = (acciones: string[], activos: string[] = ["stock"]) => {
  mundo.permisos = ok({ acciones, modulos: { activos, enSoloLectura: [] } });
};

beforeEach(() => {
  mundo.fallan = false;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("puedeEditarRecetas", () => {
  it("con composiciones.editar (gerente o administrador): sí", async () => {
    conPermisos(["stock.ver", "composiciones.editar"]);
    expect(await puedeEditarRecetas(contexto())).toBe(true);
  });

  it("solo con stock.ver (un operador): no", async () => {
    conPermisos(["stock.ver"]);
    expect(await puedeEditarRecetas(contexto())).toBe(false);
  });

  it("con el módulo en solo lectura o sin activar (la acción no figura): no", async () => {
    mundo.permisos = ok({
      acciones: ["stock.ver"],
      modulos: { activos: [], enSoloLectura: ["stock"] },
    });
    expect(await puedeEditarRecetas(contexto())).toBe(false);
    conPermisos([], []);
    expect(await puedeEditarRecetas(contexto())).toBe(false);
  });

  it("si no se pudieron leer los permisos (rechazo o excepción): no", async () => {
    mundo.permisos = err({ codigo: "SIN_PERMISO" });
    expect(await puedeEditarRecetas(contexto())).toBe(false);
    mundo.fallan = true;
    expect(await puedeEditarRecetas(contexto())).toBe(false);
  });
});
