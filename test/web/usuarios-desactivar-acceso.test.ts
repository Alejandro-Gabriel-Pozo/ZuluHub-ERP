import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok } from "../../src/primitivas/resultado/resultado";

/**
 * «Desactivar» de la ficha de Usuarios se ofrece según la oferta de `usuarios.apagar` que calcula el servidor con `permisosDelActor` (gerente y administrador): sin el rol, con el módulo en solo lectura o si
 * no se pudieron leer los permisos, no. Previene: ofrecer el botón a quien el servidor va a rechazar y abrir ante una duda (todo nace cerrado). Ocultar no es autorizar: la acción vuelve a pasar por el guard.
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
vi.mock("react", async (original) => {
  const react: object = await original();
  // Sin caché entre pruebas: cada llamada lee los permisos de nuevo.
  return { ...react, cache: <T>(f: T) => f };
});

import { puedeDesactivarUsuarios } from "../../apps/web/servidor/ofertas-de-administracion";

const contexto = { id: "contexto" } as never;
const conPermisos = (
  acciones: string[],
  modulos = { activos: ["administracion"], enSoloLectura: [] as string[] },
) => {
  mundo.permisos = ok({ acciones, modulos });
};

describe("puedeDesactivarUsuarios", () => {
  beforeEach(() => {
    mundo.permisos = null;
    mundo.fallan = false;
  });

  it("se ofrece a quien tiene usuarios.apagar con el módulo activo", async () => {
    conPermisos(["usuarios.ver", "usuarios.apagar"]);
    expect(await puedeDesactivarUsuarios(contexto)).toBe(true);
  });

  it("no se ofrece a quien no la tiene (un empleado) aunque pueda ver", async () => {
    conPermisos(["usuarios.ver"]);
    expect(await puedeDesactivarUsuarios(contexto)).toBe(false);
  });

  it("no se ofrece con el módulo en solo lectura ni sin activar (la acción no figura entre las que el servidor deja hacer)", async () => {
    conPermisos(["usuarios.ver"], { activos: [], enSoloLectura: ["administracion"] });
    expect(await puedeDesactivarUsuarios(contexto)).toBe(false);
    conPermisos([], { activos: [], enSoloLectura: [] });
    expect(await puedeDesactivarUsuarios(contexto)).toBe(false);
  });

  it("si no se pudieron leer los permisos (rechazo o excepción) no se ofrece: ante la duda, cierra", async () => {
    mundo.permisos = { ok: false, error: "SIN_PERMISO" };
    expect(await puedeDesactivarUsuarios(contexto)).toBe(false);
    mundo.fallan = true;
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await puedeDesactivarUsuarios(contexto)).toBe(false);
    error.mockRestore();
  });
});
