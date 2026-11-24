import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `desactivarElUsuario` (`apps/web/servidor/usuarios.ts`): la capa fina entre la acción de servidor y la composición. Lo que se prueba acá: resuelve la empresa y quien pide con `conLaEmpresa` (nunca del navegador),
 * manda SOLO el id, devuelve `{ error: null }` o el error ya traducido, y SIEMPRE vuelve a pedir la lista y la ficha (con éxito o sin él: si otra persona ya había desactivado, o el servidor rechazó, la pantalla
 * muestra lo que quedó). Previene: mostrar «Activo» y el botón «Desactivar» después de que la persona ya quedó desactivada.
 */
vi.mock("server-only", () => ({}));
const mundo = vi.hoisted(() => ({
  revalidadas: [] as string[],
  contextos: [] as unknown[],
  casos: [] as unknown[][],
  rechaza: false,
}));
vi.mock("next/cache", () => ({
  revalidatePath: (ruta: string) => mundo.revalidadas.push(ruta),
}));
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    casosDeUsoDeIdentidad: () => ({
      apagarMembresia: (...args: unknown[]) => {
        mundo.casos.push(args);
        return Promise.resolve(
          mundo.rechaza
            ? { ok: false, error: "ES_UNO_MISMO" }
            : { ok: true, valor: { yaEstabaApagada: false, invitacionesRevocadas: 0 } },
        );
      },
    }),
    consultasDeIdentidad: () => ({}),
  },
}));
vi.mock("../../apps/web/servidor/sesion", () => ({
  dependenciasDeSesion: {
    respuesta: { registrar: () => undefined, azar: () => new Uint8Array(4) },
  },
}));
vi.mock("../../apps/web/servidor/con-la-empresa", () => ({
  conLaEmpresa: (hacer: (contexto: unknown) => Promise<unknown>) => {
    const contexto = { empresaId: "e-de-la-sesion", personaId: "p-de-la-sesion" };
    mundo.contextos.push(contexto);
    return hacer(contexto);
  },
}));

import { desactivarElUsuario } from "../../apps/web/servidor/usuarios";

const PERSONA = "0b0b0b0b-1111-4222-8333-444444444441";

beforeEach(() => {
  mundo.revalidadas.length = 0;
  mundo.contextos.length = 0;
  mundo.casos.length = 0;
  mundo.rechaza = false;
});

describe("desactivarElUsuario", () => {
  it("desactiva con el contexto de la sesión y SOLO el id, y vuelve a pedir la lista y la ficha", async () => {
    expect(await desactivarElUsuario(PERSONA)).toEqual({ error: null });
    expect(mundo.casos).toEqual([[mundo.contextos[0], { personaId: PERSONA }]]);
    expect(mundo.revalidadas).toEqual(["/cuenta/usuarios", `/cuenta/usuarios/${PERSONA}`]);
  });

  it("un rechazo del servidor (aquí, desactivarse a uno mismo) sale como el genérico y también vuelve a pedir la página", async () => {
    mundo.rechaza = true;
    expect(await desactivarElUsuario(PERSONA)).toMatchObject({
      error: { codigo: "USUARIOS_NO_PERMITIDO" },
    });
    expect(mundo.revalidadas).toEqual(["/cuenta/usuarios", `/cuenta/usuarios/${PERSONA}`]);
  });

  it("un id que no es un identificador no llega al caso de uso", async () => {
    expect(await desactivarElUsuario("no-es-un-id")).toMatchObject({
      error: { codigo: "USUARIOS_NO_PERMITIDO" },
    });
    expect(mundo.casos).toEqual([]);
  });
});
