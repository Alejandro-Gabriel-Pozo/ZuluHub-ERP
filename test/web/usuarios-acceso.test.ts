import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "../../src/primitivas/resultado/resultado";

/**
 * Los botones de «Usuarios» (tramo U2): salen solo si `permisosDelActor` (el mismo cálculo que el guard) incluye la acción de cada uno. Previene: ofrecer «Invitar», «Reenviar» o «Revocar» a quien el
 * servidor va a rechazar (un empleado), con el módulo en solo lectura o si no se pudieron leer los permisos («todo nace cerrado»). Es solo una ayuda: cada acción vuelve a pasar por el guard.
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
const RUTA = "../../apps/web/servidor/ofertas-de-administracion";
const ofertas = async (): Promise<Record<string, boolean>> => {
  const modulo = (await import(/* @vite-ignore */ RUTA)) as {
    ofertasDeUsuarios: (c: never) => Promise<Record<string, boolean>>;
  };
  return modulo.ofertasDeUsuarios({ empresaId: "e-1" } as never);
};
const conPermisos = (acciones: string[], enSoloLectura: string[] = []) => {
  mundo.permisos = ok({
    acciones,
    modulos: { activos: ["administracion"], enSoloLectura },
  });
};
const TODAS = [
  "usuarios.ver",
  "usuarios.invitar",
  "usuarios.reenviar_invitacion",
  "usuarios.revocar_invitacion",
];
beforeEach(() => {
  mundo.fallan = false;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("ofertasDeUsuarios", () => {
  it("gerente o administrador (tienen las tres acciones): se ofrecen los tres botones", async () => {
    conPermisos(TODAS);
    expect(await ofertas()).toEqual({ invitar: true, reenviar: true, revocar: true });
  });

  it("cada botón sale solo con SU acción", async () => {
    conPermisos(["usuarios.ver", "usuarios.reenviar_invitacion"]);
    expect(await ofertas()).toEqual({ invitar: false, reenviar: true, revocar: false });
  });

  it("un empleado (sin ninguna de las tres): ningún botón", async () => {
    conPermisos([]);
    expect(await ofertas()).toEqual({ invitar: false, reenviar: false, revocar: false });
  });

  it("sin permisos leídos (error o falla): todo cerrado", async () => {
    mundo.permisos = err("SIN_PERMISO");
    expect(await ofertas()).toEqual({ invitar: false, reenviar: false, revocar: false });
    mundo.fallan = true;
    expect(await ofertas()).toEqual({ invitar: false, reenviar: false, revocar: false });
  });
});
