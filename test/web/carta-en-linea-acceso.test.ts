import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "../../src/primitivas/resultado/resultado";

/**
 * Los botones de «Carta en línea»: «Guardar» sale activo solo con `vidrieras.editar`, «Poner en línea» con `vidrieras.publicar_en_linea` y «Sacar de línea» con `vidrieras.retirar_de_linea`, según
 * `permisosDelActor` (el mismo cálculo que el guard). Previene: ofrecer un botón a quien el servidor va a rechazar (un operador), con el módulo en desarrollo (hoy: la acción no figura) o sin leer
 * los permisos («todo nace cerrado»). Es solo una ayuda: cada acción vuelve a pasar por el guard.
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
const oferta = async (contexto: never) => {
  const modulo = (await import(/* @vite-ignore */ RUTA)) as {
    ofertaDeLaCartaEnLinea: (
      c: never,
    ) => Promise<{ guardar: boolean; poner: boolean; sacar: boolean }>;
  };
  return modulo.ofertaDeLaCartaEnLinea(contexto);
};
const contexto = () => ({ empresaId: "e-1" }) as never;
const conPermisos = (acciones: string[], activos: string[] = ["vidriera"]) => {
  mundo.permisos = ok({ acciones, modulos: { activos, enSoloLectura: [] } });
};
const CIERRA = { guardar: false, poner: false, sacar: false };

beforeEach(() => {
  mundo.fallan = false;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("ofertaDeLaCartaEnLinea", () => {
  it("gerente y administrador (las cuatro acciones): todo activo", async () => {
    conPermisos([
      "vidrieras.ver",
      "vidrieras.editar",
      "vidrieras.publicar_en_linea",
      "vidrieras.retirar_de_linea",
    ]);
    expect(await oferta(contexto())).toEqual({ guardar: true, poner: true, sacar: true });
  });

  it("cada botón sigue a su propia acción", async () => {
    conPermisos(["vidrieras.ver", "vidrieras.editar"]);
    expect(await oferta(contexto())).toEqual({ guardar: true, poner: false, sacar: false });
    conPermisos(["vidrieras.ver", "vidrieras.retirar_de_linea"]);
    expect(await oferta(contexto())).toEqual({ guardar: false, poner: false, sacar: true });
  });

  it("solo con vidrieras.ver (un operador) o con el módulo en desarrollo o sin activar (la acción no figura): todo apagado", async () => {
    conPermisos(["vidrieras.ver"]);
    expect(await oferta(contexto())).toEqual(CIERRA);
    conPermisos([], []);
    expect(await oferta(contexto())).toEqual(CIERRA);
  });

  it("si no se pudieron leer los permisos (rechazo o excepción): todo apagado", async () => {
    mundo.permisos = err({ codigo: "SIN_PERMISO" });
    expect(await oferta(contexto())).toEqual(CIERRA);
    mundo.fallan = true;
    expect(await oferta(contexto())).toEqual(CIERRA);
  });
});
