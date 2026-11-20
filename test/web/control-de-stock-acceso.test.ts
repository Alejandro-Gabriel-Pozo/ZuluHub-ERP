import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "../../src/primitivas/resultado/resultado";

/**
 * La casilla «Se controla el stock» de la ficha: sale cambiable solo si `permisosDelActor` (el mismo cálculo que el guard) incluye `articulos.controlar` (gerente y administrador). Previene:
 * ofrecer la casilla a quien el servidor va a rechazar (un operador), con el módulo de stock en solo lectura o sin activar, o si no se pudieron leer los permisos («todo nace cerrado»). Es solo
 * la ayuda: fijar el control vuelve a pasar por el guard.
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

// Se carga por una ruta en una variable: la prueba de tipos de `test/` no sigue la importación (igual que las otras pruebas de acceso).
const RUTA = "../../apps/web/servidor/ofertas-de-catalogo";
const puedeControlarElStock = async (contexto: never): Promise<boolean> => {
  const modulo = (await import(/* @vite-ignore */ RUTA)) as {
    puedeControlarElStock: (c: never) => Promise<boolean>;
  };
  return modulo.puedeControlarElStock(contexto);
};

const contexto = () => ({ empresaId: "e-1" }) as never;
const conPermisos = (acciones: string[], activos: string[] = ["stock"]) => {
  mundo.permisos = ok({ acciones, modulos: { activos, enSoloLectura: [] } });
};

beforeEach(() => {
  mundo.fallan = false;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("puedeControlarElStock", () => {
  it("con articulos.controlar (gerente o administrador): sí", async () => {
    conPermisos(["stock.ver", "articulos.controlar"]);
    expect(await puedeControlarElStock(contexto())).toBe(true);
  });

  it("solo con stock.ver (un operador): no", async () => {
    conPermisos(["stock.ver"]);
    expect(await puedeControlarElStock(contexto())).toBe(false);
  });

  it("con el módulo de stock en solo lectura o sin activar (la acción no figura): no", async () => {
    mundo.permisos = ok({
      acciones: ["stock.ver"],
      modulos: { activos: [], enSoloLectura: ["stock"] },
    });
    expect(await puedeControlarElStock(contexto())).toBe(false);
  });

  it("si no se pudieron leer los permisos (error o excepción): no (cierra, no abre)", async () => {
    mundo.permisos = err("SIN_SESION");
    expect(await puedeControlarElStock(contexto())).toBe(false);
    mundo.fallan = true;
    expect(await puedeControlarElStock(contexto())).toBe(false);
  });
});
