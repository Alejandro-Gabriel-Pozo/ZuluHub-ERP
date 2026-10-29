import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "../../src/primitivas/resultado/resultado";

/**
 * La barra de módulos (D-13): «Comprobantes» se muestra solo si la persona tiene hoy `comprobantes.ver` Y el módulo de facturación
 * está activo o en solo lectura (`permisosDelActor`, calculado por el servidor). Previene: ofrecer un destino que el servidor va a
 * rechazar, y abrir uno cuando no se pudo saber (ante el error, cierra). Ocultar no autoriza: la consulta del listado vuelve al guard.
 */
vi.mock("server-only", () => ({}));

const mundo = vi.hoisted((): { respuesta: unknown; falla: boolean; contextos: unknown[] } => ({
  respuesta: null,
  falla: false,
  contextos: [],
}));
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    consultasDeEmpresas: () => ({
      permisosDelActor: (contexto: unknown) => {
        mundo.contextos.push(contexto);
        if (mundo.falla) return Promise.reject(new Error("la base no responde"));
        return Promise.resolve(mundo.respuesta);
      },
    }),
  },
}));

const RUTA = "../../apps/web/servidor/modulos";
// Ruta en una variable: el tipado de la raíz no arrastra los archivos del navegador que importa la barra.
const cargar = (
  ruta: string,
): Promise<{
  destinosDeModulos: (contexto: unknown) => Promise<readonly { clave: string }[]>;
}> => import(/* @vite-ignore */ ruta);

const claves = async (): Promise<string[]> => {
  const { destinosDeModulos } = await cargar(RUTA);
  return (await destinosDeModulos({ empresaId: "empresa-1" })).map((d) => d.clave);
};
const permisos = (p: { acciones?: string[]; activos?: string[]; enSoloLectura?: string[] }) => {
  mundo.respuesta = ok({
    acciones: p.acciones ?? ["comprobantes.ver"],
    modulos: { activos: p.activos ?? [], enSoloLectura: p.enSoloLectura ?? [] },
  });
};

beforeEach(() => {
  mundo.falla = false;
  mundo.contextos = [];
  permisos({ activos: ["facturacion"] });
});

describe("destinosDeModulos", () => {
  it("con comprobantes.ver y el módulo de facturación activo: «Comprobantes»; la consulta usa el contexto de la empresa", async () => {
    expect(await claves()).toEqual(["comprobantes"]);
    expect(mundo.contextos).toEqual([{ empresaId: "empresa-1" }]);
  });

  it("SUPUESTO: con el módulo en solo lectura también aparece (el Listado solo consulta)", async () => {
    permisos({ enSoloLectura: ["facturacion"] });
    expect(await claves()).toEqual(["comprobantes"]);
  });

  it("sin comprobantes.ver no aparece, aunque el módulo esté activo", async () => {
    permisos({ acciones: ["comprobantes.emitir_manual"], activos: ["facturacion"] });
    expect(await claves()).toEqual([]);
  });

  it("sin el módulo de facturación (ni activo ni en solo lectura) no aparece, aunque figure la acción", async () => {
    permisos({ activos: ["administracion"] });
    expect(await claves()).toEqual([]);
  });

  it("si no se pudieron leer los permisos (rechazo): no aparece", async () => {
    mundo.respuesta = err({ codigo: "SIN_PERMISO" });
    expect(await claves()).toEqual([]);
  });

  it("si la consulta falla con una excepción: no aparece y no rompe", async () => {
    mundo.falla = true;
    expect(await claves()).toEqual([]);
  });
});
