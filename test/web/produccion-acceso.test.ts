import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok } from "../../src/primitivas/resultado/resultado";

/**
 * Los botones «Cancelar la orden» y «Anular la orden» de la ficha de una orden de producción: salen solo si `permisosDelActor` (el mismo cálculo que el guard) incluye
 * `transformaciones.cancelar` / `transformaciones.anular` (gerente y administrador). Previene: ofrecer el botón a quien el servidor va a rechazar (un operador, que abre y mira), con el
 * módulo en desarrollo o no activo (la acción no figura), o si no se pudieron leer los permisos («todo nace cerrado»). Cancelar y anular cierran lo iniciado: pasan con el módulo en solo
 * lectura. Es solo la ayuda: cada acción vuelve a pasar por el guard.
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
const RUTA = "../../apps/web/servidor/ofertas-de-produccion";
const accionesDeProduccion = async (
  contexto: never,
): Promise<{ cancelar: boolean; anular: boolean }> => {
  const modulo = (await import(/* @vite-ignore */ RUTA)) as {
    accionesDeProduccion: (c: never) => Promise<{ cancelar: boolean; anular: boolean }>;
  };
  return modulo.accionesDeProduccion(contexto);
};

const contexto = () => ({ empresaId: "e-1" }) as never;
const conPermisos = (acciones: string[], activos: string[] = ["produccion"]) => {
  mundo.permisos = ok({ acciones, modulos: { activos, enSoloLectura: [] } });
};

beforeEach(() => {
  mundo.fallan = false;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("accionesDeProduccion", () => {
  it("con cancelar y anular (gerente o administrador): las dos", async () => {
    conPermisos(["transformaciones.ver", "transformaciones.cancelar", "transformaciones.anular"]);
    expect(await accionesDeProduccion(contexto())).toEqual({ cancelar: true, anular: true });
  });

  it("cada una por separado", async () => {
    conPermisos(["transformaciones.cancelar"]);
    expect(await accionesDeProduccion(contexto())).toEqual({ cancelar: true, anular: false });
    conPermisos(["transformaciones.anular"]);
    expect(await accionesDeProduccion(contexto())).toEqual({ cancelar: false, anular: true });
  });

  it("solo con ver y abrir (un operador): ninguna", async () => {
    conPermisos(["transformaciones.ver", "transformaciones.abrir"]);
    expect(await accionesDeProduccion(contexto())).toEqual({ cancelar: false, anular: false });
  });

  it("con el módulo en desarrollo o sin activar (la acción no figura): ninguna", async () => {
    mundo.permisos = ok({
      acciones: [],
      modulos: { activos: [], enSoloLectura: [] },
    });
    expect(await accionesDeProduccion(contexto())).toEqual({ cancelar: false, anular: false });
  });

  it("con el módulo en solo lectura, cancelar y anular siguen (cierran lo iniciado)", async () => {
    mundo.permisos = ok({
      acciones: ["transformaciones.cancelar", "transformaciones.anular"],
      modulos: { activos: [], enSoloLectura: ["produccion"] },
    });
    expect(await accionesDeProduccion(contexto())).toEqual({ cancelar: true, anular: true });
  });

  it("si no se pudieron leer los permisos (sin ellos o con una falla), ninguna", async () => {
    mundo.permisos = null;
    expect(await accionesDeProduccion(contexto())).toEqual({ cancelar: false, anular: false });
    mundo.fallan = true;
    expect(await accionesDeProduccion(contexto())).toEqual({ cancelar: false, anular: false });
  });
});
