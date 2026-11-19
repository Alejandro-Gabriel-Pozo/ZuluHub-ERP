import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "../../src/primitivas/resultado/resultado";

/**
 * Qué acciones de la pantalla «Caja» del mostrador se ofrecen activas: cada acción (abrir, iniciar y cancelar el cierre, cerrar) sale activa solo si `permisosDelActor` (el mismo cálculo que el guard) incluye su acción de permiso.
 * Previene: ofrecer un botón a quien el servidor va a rechazar, con el módulo `caja` en desarrollo o sin activar (la lista no trae sus acciones) o si no se pudieron leer los permisos («todo
 * nace cerrado»). Es solo una ayuda: cada acción vuelve a pasar por el guard.
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

type Acciones = Record<"abrir" | "iniciarCierre" | "cancelarCierre" | "cerrar", boolean>;
const TODO: Acciones = { abrir: true, iniciarCierre: true, cancelarCierre: true, cerrar: true };
const NADA: Acciones = { abrir: false, iniciarCierre: false, cancelarCierre: false, cerrar: false };
// Se carga por una ruta en una variable: la prueba de tipos de `test/` no sigue la importación y no arrastra los componentes del navegador (igual que las otras pruebas de acceso).
const RUTA = "../../apps/web/servidor/ofertas-de-caja";
const acciones = async (): Promise<Acciones> => {
  const modulo = (await import(/* @vite-ignore */ RUTA)) as {
    accionesDeLaPantallaDeCaja: (c: never) => Promise<Acciones>;
  };
  return modulo.accionesDeLaPantallaDeCaja({ empresaId: "e-1" } as never);
};

const conPermisos = (lista: string[], activos: string[] = ["caja"]) => {
  mundo.permisos = ok({ acciones: lista, modulos: { activos, enSoloLectura: [] } });
};

beforeEach(() => {
  mundo.fallan = false;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("accionesDeLaPantallaDeCaja", () => {
  it("con todas las acciones de la sesión de caja: todo activo", async () => {
    conPermisos([
      "cajas.ver",
      "sesiones_caja.abrir",
      "sesiones_caja.iniciar_cierre",
      "sesiones_caja.cancelar_cierre",
      "sesiones_caja.cerrar",
    ]);
    expect(await acciones()).toEqual(TODO);
  });

  it("cada acción depende de su propia acción de permiso", async () => {
    conPermisos(["sesiones_caja.cerrar"]);
    expect(await acciones()).toEqual({ ...NADA, cerrar: true });
    conPermisos(["sesiones_caja.iniciar_cierre"]);
    expect(await acciones()).toEqual({ ...NADA, iniciarCierre: true });
    conPermisos(["sesiones_caja.cancelar_cierre"]);
    expect(await acciones()).toEqual({ ...NADA, cancelarCierre: true });
  });

  it("solo ver la caja no alcanza para nada", async () => {
    conPermisos(["cajas.ver"]);
    expect(await acciones()).toEqual(NADA);
  });

  it("con el módulo en desarrollo o sin activar (la acción no figura): todo apagado", async () => {
    conPermisos([], []);
    expect(await acciones()).toEqual(NADA);
  });

  it("si no se pudieron leer los permisos (rechazo o excepción): todo apagado", async () => {
    mundo.permisos = err({ codigo: "SIN_PERMISO" });
    expect(await acciones()).toEqual(NADA);
    mundo.fallan = true;
    expect(await acciones()).toEqual(NADA);
  });
});
