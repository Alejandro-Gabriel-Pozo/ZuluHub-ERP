import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "../../src/primitivas/resultado/resultado";

/**
 * Los botones de «Clientes y proveedores» (`accionesDelDirectorio`): salen activos solo si `permisosDelActor` (el mismo cálculo que el guard) incluye la acción. Editar guarda datos y roles
 * juntos y pide las dos (`partes.editar` y `partes.cambiar_roles`); los contactos piden vincular y desvincular. Previene: ofrecer un botón que el servidor va a rechazar, o dejarlos abiertos
 * si no se pudieron leer los permisos («todo nace cerrado»). Es solo una ayuda: cada acción vuelve a pasar por el guard dentro de su transacción.
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
const RUTA = "../../apps/web/servidor/ofertas-de-clientes";
type Acciones = Readonly<{
  crear: boolean;
  editar: boolean;
  desactivar: boolean;
  reactivar: boolean;
  contactos: boolean;
}>;
const acciones = async (): Promise<Acciones> => {
  const modulo = (await import(/* @vite-ignore */ RUTA)) as {
    accionesDelDirectorio: (c: never) => Promise<Acciones>;
  };
  return modulo.accionesDelDirectorio({ empresaId: "e-1" } as never);
};
const conPermisos = (lista: string[], activos: string[] = ["clientes"]) => {
  mundo.permisos = ok({ acciones: lista, modulos: { activos, enSoloLectura: [] } });
};
const TODAS = [
  "partes.ver",
  "partes.crear",
  "partes.editar",
  "partes.cambiar_roles",
  "partes.vincular_contacto",
  "partes.desvincular_contacto",
  "partes.desactivar",
  "partes.reactivar",
];
const TODO_APAGADO: Acciones = {
  crear: false,
  editar: false,
  desactivar: false,
  reactivar: false,
  contactos: false,
};
beforeEach(() => {
  mundo.fallan = false;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("accionesDelDirectorio", () => {
  it("gerente o administrador (todas las acciones de partes): los cinco botones", async () => {
    conPermisos(TODAS);
    expect(await acciones()).toEqual({
      crear: true,
      editar: true,
      desactivar: true,
      reactivar: true,
      contactos: true,
    });
  });

  it("operador (sin desactivar ni reactivar): esos dos apagados y el resto activos", async () => {
    conPermisos(TODAS.filter((a) => a !== "partes.desactivar" && a !== "partes.reactivar"));
    expect(await acciones()).toEqual({
      crear: true,
      editar: true,
      desactivar: false,
      reactivar: false,
      contactos: true,
    });
  });

  it("editar pide datos y roles: sin partes.cambiar_roles o sin partes.editar, apagado", async () => {
    conPermisos(TODAS.filter((a) => a !== "partes.cambiar_roles"));
    expect((await acciones()).editar).toBe(false);
    conPermisos(TODAS.filter((a) => a !== "partes.editar"));
    expect((await acciones()).editar).toBe(false);
  });

  it("contactos pide vincular y desvincular: con una sola, apagado", async () => {
    conPermisos(TODAS.filter((a) => a !== "partes.vincular_contacto"));
    expect((await acciones()).contactos).toBe(false);
    conPermisos(TODAS.filter((a) => a !== "partes.desvincular_contacto"));
    expect((await acciones()).contactos).toBe(false);
  });

  it("con el módulo sin acciones (no activo o en desarrollo): todo apagado", async () => {
    conPermisos([], []);
    expect(await acciones()).toEqual(TODO_APAGADO);
  });

  it("sin permisos leídos (error del resultado o falla de la base): todo apagado", async () => {
    mundo.permisos = err("SIN_PERMISO");
    expect(await acciones()).toEqual(TODO_APAGADO);
    mundo.fallan = true;
    expect(await acciones()).toEqual(TODO_APAGADO);
  });
});
