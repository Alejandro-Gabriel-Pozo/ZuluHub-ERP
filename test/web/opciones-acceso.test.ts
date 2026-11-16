import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "../../src/primitivas/resultado/resultado";

/**
 * «Guardar», «Copiar» y los enlaces de escribir de las opciones de un producto: salen solo si `permisosDelActor` (el mismo cálculo que el guard) incluye `opciones.editar` (gerente y
 * administrador). Previene: ofrecer el botón a quien el servidor va a rechazar (un operador), con el módulo en solo lectura (editar opciones CREA_AMPLIA, la acción no figura) o en
 * desarrollo, o si no se pudieron leer los permisos («todo nace cerrado»). Es solo la ayuda de DEC-0346: guardar vuelve a pasar por el guard.
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
const puedeEditarOpciones = async (contexto: never): Promise<boolean> => {
  const modulo = (await import(/* @vite-ignore */ RUTA)) as {
    puedeEditarOpciones: (c: never) => Promise<boolean>;
  };
  return modulo.puedeEditarOpciones(contexto);
};

const contexto = () => ({ empresaId: "e-1" }) as never;
const conPermisos = (acciones: string[], activos: string[] = ["catalogo"]) => {
  mundo.permisos = ok({ acciones, modulos: { activos, enSoloLectura: [] } });
};

beforeEach(() => {
  mundo.fallan = false;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("puedeEditarOpciones", () => {
  it("con opciones.editar (gerente o administrador): sí", async () => {
    conPermisos(["productos.ver", "opciones.editar"]);
    expect(await puedeEditarOpciones(contexto())).toBe(true);
  });

  it("con productos.editar pero sin opciones.editar: no (son permisos distintos)", async () => {
    conPermisos(["productos.ver", "productos.editar", "productos.cambiar_precio"]);
    expect(await puedeEditarOpciones(contexto())).toBe(false);
  });

  it("solo con productos.ver (un operador): no", async () => {
    conPermisos(["productos.ver"]);
    expect(await puedeEditarOpciones(contexto())).toBe(false);
  });

  it("con el módulo en solo lectura o sin activar (la acción no figura): no", async () => {
    mundo.permisos = ok({
      acciones: ["productos.ver"],
      modulos: { activos: [], enSoloLectura: ["catalogo"] },
    });
    expect(await puedeEditarOpciones(contexto())).toBe(false);
    conPermisos([], []);
    expect(await puedeEditarOpciones(contexto())).toBe(false);
  });

  it("si no se pudieron leer los permisos (rechazo o excepción): no", async () => {
    mundo.permisos = err({ codigo: "SIN_PERMISO" });
    expect(await puedeEditarOpciones(contexto())).toBe(false);
    mundo.fallan = true;
    expect(await puedeEditarOpciones(contexto())).toBe(false);
  });
});
