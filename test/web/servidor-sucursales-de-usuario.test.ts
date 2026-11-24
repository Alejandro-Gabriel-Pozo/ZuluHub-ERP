import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `apps/web/servidor/usuarios.ts`, las sucursales de un empleado (tramo U4): de lo que manda el navegador solo se toman las casillas tildadas (`sucursales`) y la persona ligada con `.bind`;
 * la empresa y quien actúa salen de la sesión. La composición es la real (`src/composicion/usuarios-web.ts`); las consultas y el caso de uso son falsos (con la base real se prueban en
 * `test/integracion/usuarios-web-sucursales.test.ts`).
 * Previene: confundir «ninguna casilla» con «no mandó nada», guardar lo que el navegador agregue (empresa, rol) y mostrar una ficha vieja tras guardar.
 */
vi.mock("server-only", () => ({}));
const CONTEXTO = { empresaId: "empresa-de-la-sesion" };
const PERSONA = "11111111-1111-4111-8111-111111111111";
const S1 = "22222222-2222-4222-8222-222222222221";
const S2 = "22222222-2222-4222-8222-222222222222";
const mundo = vi.hoisted(
  (): {
    puede: boolean;
    asignaciones: Record<string, unknown>[];
    revalidadas: string[];
    rolDelMiembro: string;
  } => ({ puede: true, asignaciones: [], revalidadas: [], rolDelMiembro: "OPERADOR" }),
);
vi.mock("next/cache", () => ({
  revalidatePath: (ruta: string) => mundo.revalidadas.push(ruta),
}));
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    consultasDeIdentidad: () => ({
      listarMiembros: () =>
        Promise.resolve({
          ok: true,
          valor: [
            {
              personaId: PERSONA,
              email: "a@x.test",
              rol: mundo.rolDelMiembro,
              activo: true,
              sucursales: [S1],
            },
          ],
        }),
    }),
    consultasDeEmpresas: () => ({
      listarSucursales: () =>
        Promise.resolve({
          ok: true,
          valor: [
            { id: S1, nombre: "Centro" },
            { id: S2, nombre: "Norte" },
          ],
        }),
    }),
    casosDeUsoDeIdentidad: () => ({
      asignarSucursales: (_c: unknown, entrada: Record<string, unknown>) => {
        mundo.asignaciones.push(entrada);
        return Promise.resolve({
          ok: true,
          valor: { agregadas: [], reactivadas: [], quitadas: [] },
        });
      },
    }),
  },
}));
vi.mock("../../apps/web/servidor/sesion", () => ({
  dependenciasDeSesion: {
    respuesta: { registrar: () => undefined, azar: () => new Uint8Array(4) },
  },
}));
vi.mock("../../apps/web/servidor/con-la-empresa", () => ({
  conLaEmpresa: (hacer: (contexto: unknown) => unknown) => hacer(CONTEXTO),
}));
vi.mock("../../apps/web/servidor/permisos-de-la-persona", () => ({
  puedeLaAccion: (_contexto: unknown, accion: string) =>
    Promise.resolve(mundo.puede && accion === "usuarios.asignar_sucursales"),
}));

import {
  cargarElEditorDeSucursales,
  guardarLasSucursalesDeUnEmpleado,
} from "../../apps/web/servidor/usuarios";

const formulario = (...ids: string[]) => {
  const datos = new FormData();
  for (const id of ids) datos.append("sucursales", id);
  return datos;
};

beforeEach(() => {
  Object.assign(mundo, {
    puede: true,
    asignaciones: [],
    revalidadas: [],
    rolDelMiembro: "OPERADOR",
  });
});

describe("guardarLasSucursalesDeUnEmpleado", () => {
  it("manda al caso de uso la persona ligada y las casillas tildadas, y vuelve a pedir la ficha", async () => {
    const r = await guardarLasSucursalesDeUnEmpleado(PERSONA, formulario(S1, S2));
    expect(r).toEqual({ error: null });
    expect(mundo.asignaciones).toEqual([{ personaId: PERSONA, sucursales: [S1, S2] }]);
    expect(mundo.revalidadas).toEqual([`/cuenta/usuarios/${PERSONA}`]);
  });

  it("ninguna casilla tildada es el conjunto vacío: se manda `sucursales: []`", async () => {
    expect(await guardarLasSucursalesDeUnEmpleado(PERSONA, formulario())).toEqual({ error: null });
    expect(mundo.asignaciones).toEqual([{ personaId: PERSONA, sucursales: [] }]);
  });

  it("un pedido que no es un formulario NO es «ninguna casilla»: el genérico y no se escribe", async () => {
    for (const malo of [undefined, null, "texto", { sucursales: [] }]) {
      const r = await guardarLasSucursalesDeUnEmpleado(PERSONA, malo);
      expect(r).toMatchObject({ error: { codigo: "USUARIOS_NO_PERMITIDO" } });
    }
    expect(mundo.asignaciones).toEqual([]);
  });

  it("lo que no son las casillas (empresa, rol, archivos) se descarta", async () => {
    const datos = formulario(S1);
    datos.append("empresaId", "otra");
    datos.append("rol", "GERENTE");
    datos.append("sucursales", new Blob(["x"]), "archivo.txt");
    await guardarLasSucursalesDeUnEmpleado(PERSONA, datos);
    expect(mundo.asignaciones).toEqual([{ personaId: PERSONA, sucursales: [S1] }]);
  });

  it("una persona que no es un empleado activo, o una ficha mal escrita, sale como el genérico, vuelve a pedir la ficha y no escribe", async () => {
    mundo.rolDelMiembro = "ADMINISTRADOR";
    expect(await guardarLasSucursalesDeUnEmpleado(PERSONA, formulario(S1))).toMatchObject({
      error: { codigo: "USUARIOS_NO_PERMITIDO" },
    });
    expect(await guardarLasSucursalesDeUnEmpleado("no-es-un-id", formulario(S1))).toMatchObject({
      error: { codigo: "USUARIOS_NO_PERMITIDO" },
    });
    expect(mundo.asignaciones).toEqual([]);
    expect(mundo.revalidadas).toHaveLength(2);
  });
});

describe("cargarElEditorDeSucursales", () => {
  it("con permiso, ofrece las casillas del empleado con sus tildes", async () => {
    expect(await cargarElEditorDeSucursales(CONTEXTO as never, PERSONA)).toEqual({
      ok: true,
      dato: [
        { id: S1, nombre: "Centro", marcada: true },
        { id: S2, nombre: "Norte", marcada: false },
      ],
    });
  });

  it("sin `usuarios.asignar_sucursales` no hay bloque (null), aunque la persona sea un empleado", async () => {
    mundo.puede = false;
    expect(await cargarElEditorDeSucursales(CONTEXTO as never, PERSONA)).toEqual({
      ok: true,
      dato: null,
    });
  });

  it("para un administrador no hay bloque (null)", async () => {
    mundo.rolDelMiembro = "ADMINISTRADOR";
    expect(await cargarElEditorDeSucursales(CONTEXTO as never, PERSONA)).toEqual({
      ok: true,
      dato: null,
    });
  });
});
