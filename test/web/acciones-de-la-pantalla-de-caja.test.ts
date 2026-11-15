import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "../../src/primitivas/resultado/resultado";

/**
 * Qué acciones de la pantalla «Caja» del mostrador se ofrecen activas: cada una sale activa solo si `permisosDelActor` (el mismo cálculo que el guard) incluye su acción de permiso.
 * Previene: ofrecer un botón a quien el servidor va a rechazar (un operador no ajusta ni anula movimientos de otros), con el módulo `caja` en desarrollo o sin activar (la lista no
 * trae sus acciones) o si no se pudieron leer los permisos («todo nace cerrado»). Es solo una ayuda: cada acción vuelve a pasar por el guard.
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

type Acciones = Record<
  | "abrir"
  | "iniciarCierre"
  | "cancelarCierre"
  | "cerrar"
  | "registrarMovimiento"
  | "ajustar"
  | "anular"
  | "anularDeOtros",
  boolean
>;
// Se carga por una ruta en una variable: la prueba de tipos de `test/` no sigue la importación y no arrastra los componentes del navegador (igual que las otras pruebas de acceso).
const RUTA = "../../apps/web/servidor/modulos";
const acciones = async (): Promise<Acciones> => {
  const modulo = (await import(/* @vite-ignore */ RUTA)) as {
    accionesDeLaPantallaDeCaja: (c: never) => Promise<Acciones>;
  };
  return modulo.accionesDeLaPantallaDeCaja({ empresaId: "e-1" } as never);
};

const conPermisos = (lista: string[], activos: string[] = ["caja"]) => {
  mundo.permisos = ok({ acciones: lista, modulos: { activos, enSoloLectura: [] } });
};
const TODO: Acciones = {
  abrir: true,
  iniciarCierre: true,
  cancelarCierre: true,
  cerrar: true,
  registrarMovimiento: true,
  ajustar: true,
  anular: true,
  anularDeOtros: true,
};
const NADA: Acciones = {
  abrir: false,
  iniciarCierre: false,
  cancelarCierre: false,
  cerrar: false,
  registrarMovimiento: false,
  ajustar: false,
  anular: false,
  anularDeOtros: false,
};
const DE_OPERADOR = [
  "cajas.ver",
  "sesiones_caja.abrir",
  "sesiones_caja.iniciar_cierre",
  "sesiones_caja.cancelar_cierre",
  "sesiones_caja.cerrar",
  "movimientos_caja.registrar_manual",
  "movimientos_caja.anular",
];

beforeEach(() => {
  mundo.fallan = false;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("accionesDeLaPantallaDeCaja", () => {
  it("con todas las acciones de caja (gerente o administrador): todo activo", async () => {
    conPermisos([...DE_OPERADOR, "movimientos_caja.ajustar", "movimientos_caja.anular_de_otros"]);
    expect(await acciones()).toEqual(TODO);
  });

  it("un operador: no ajusta ni anula los movimientos de otra persona", async () => {
    conPermisos(DE_OPERADOR);
    expect(await acciones()).toEqual({ ...TODO, ajustar: false, anularDeOtros: false });
  });

  it("cada acción depende de su propia acción de permiso", async () => {
    conPermisos(["movimientos_caja.ajustar"]);
    expect(await acciones()).toEqual({ ...NADA, ajustar: true });
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
