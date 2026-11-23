import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "../../src/primitivas/resultado/resultado";

/**
 * «Ocultar» y «Ocultar en toda la empresa» de la ficha: salen activos solo si `permisosDelActor` (el mismo cálculo que el guard) incluye `vidrieras.marcar_disponibilidad` (los tres roles) y
 * `vidrieras.ocultar_en_empresa` (gerente y administrador; 22A). Previene: ofrecer a quien opera el botón de toda la empresa, con el módulo `vidriera` en solo lectura o en desarrollo (la
 * acción no figura), o si no se pudieron leer los permisos («todo nace cerrado»). Es solo la ayuda que apaga el botón: ocultar vuelve a pasar por el guard.
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
type Modulo = {
  puedeOcultarEnElLocal: (c: never) => Promise<boolean>;
  puedeOcultarEnLaEmpresa: (c: never) => Promise<boolean>;
};
const cargar = async (): Promise<Modulo> => (await import(/* @vite-ignore */ RUTA)) as Modulo;

const contexto = () => ({ empresaId: "e-1" }) as never;
const conPermisos = (acciones: string[], activos: string[] = ["vidriera"]) => {
  mundo.permisos = ok({ acciones, modulos: { activos, enSoloLectura: [] } });
};

beforeEach(() => {
  mundo.fallan = false;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("puedeOcultarEnElLocal y puedeOcultarEnLaEmpresa", () => {
  it("gerente o administrador (las dos acciones): las dos", async () => {
    conPermisos([
      "vidrieras.ver",
      "vidrieras.marcar_disponibilidad",
      "vidrieras.ocultar_en_empresa",
    ]);
    const m = await cargar();
    expect(await m.puedeOcultarEnElLocal(contexto())).toBe(true);
    expect(await m.puedeOcultarEnLaEmpresa(contexto())).toBe(true);
  });

  it("operador (solo marcar disponibilidad): el local sí, la empresa no", async () => {
    conPermisos(["vidrieras.ver", "vidrieras.marcar_disponibilidad"]);
    const m = await cargar();
    expect(await m.puedeOcultarEnElLocal(contexto())).toBe(true);
    expect(await m.puedeOcultarEnLaEmpresa(contexto())).toBe(false);
  });

  it("quien tenía `vidrieras.editar` pero no la acción nueva: la empresa no (la exigencia vieja ya no vale)", async () => {
    conPermisos(["vidrieras.ver", "vidrieras.marcar_disponibilidad", "vidrieras.editar"]);
    expect(await (await cargar()).puedeOcultarEnLaEmpresa(contexto())).toBe(false);
  });

  it("con el módulo en solo lectura o sin activar (la acción no figura): ninguna", async () => {
    mundo.permisos = ok({
      acciones: ["vidrieras.ver"],
      modulos: { activos: [], enSoloLectura: ["vidriera"] },
    });
    const m = await cargar();
    expect(await m.puedeOcultarEnElLocal(contexto())).toBe(false);
    expect(await m.puedeOcultarEnLaEmpresa(contexto())).toBe(false);
  });

  it("si los permisos no se pueden leer (error o base caída): ninguna (cierra)", async () => {
    mundo.permisos = err("SIN_PERMISO");
    const m = await cargar();
    expect(await m.puedeOcultarEnElLocal(contexto())).toBe(false);
    expect(await m.puedeOcultarEnLaEmpresa(contexto())).toBe(false);
    mundo.fallan = true;
    expect(await m.puedeOcultarEnElLocal(contexto())).toBe(false);
    expect(await m.puedeOcultarEnLaEmpresa(contexto())).toBe(false);
  });
});
