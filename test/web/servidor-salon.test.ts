import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorDeCodigo } from "../../src/capacidades/experiencia/respuesta";

/**
 * `apps/web/servidor/salon.ts`: la sucursal la fija el SERVIDOR (la efectiva del dispositivo) y del formulario del navegador solo se toman los cinco datos de la mesa. Sin sucursal
 * (`efectiva` vacía) no se asume «todas»: cierra con el genérico y no llama al caso de uso. La composición es la real (`src/composicion/mesas-web.ts`); las consultas y los casos de uso son
 * falsos (con la base real se prueban en `test/integracion/mesas-web.test.ts`).
 * Previene: crear o tocar una mesa en una sucursal que la persona no eligió, o en «todas», porque lo dijo el navegador o porque no había ninguna elegida.
 */
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (ruta: string) => {
    throw new Error(`REDIRECT ${ruta}`);
  },
}));
const CONTEXTO = { empresaId: "empresa-de-la-sesion" };
const SUCURSAL = "33333333-3333-4333-8333-333333333333";
const MESA = "11111111-1111-4111-8111-111111111111";
const mundo = vi.hoisted(
  (): {
    efectiva: string;
    creaciones: Record<string, unknown>[];
    listas: Record<string, unknown>[];
  } => ({
    efectiva: "",
    creaciones: [],
    listas: [],
  }),
);
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    casosDeUsoDeSalon: () => ({
      crearMesa: (_c: unknown, entrada: Record<string, unknown>) => {
        mundo.creaciones.push(entrada);
        return Promise.resolve({
          ok: true,
          valor: { mesaId: entrada["mesaId"], version: 1, yaExistia: false },
        });
      },
      editarMesa: () =>
        Promise.resolve({ ok: true, valor: { mesaId: MESA, version: 2, yaExistia: false } }),
      desactivarMesa: () =>
        Promise.resolve({ ok: true, valor: { mesaId: MESA, version: 2, yaExistia: false } }),
      reactivarMesa: () =>
        Promise.resolve({ ok: true, valor: { mesaId: MESA, version: 3, yaExistia: false } }),
    }),
    consultasDeSalon: () => ({
      listarMesas: (_c: unknown, entrada: Record<string, unknown>) => {
        mundo.listas.push(entrada);
        return Promise.resolve({ ok: true, valor: [] });
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
vi.mock("../../apps/web/servidor/sucursal-elegida", () => ({
  sucursalDelPedido: () =>
    Promise.resolve({ ok: true, dato: { elegida: null, efectiva: mundo.efectiva } }),
}));

const RUTA = "../../apps/web/servidor/salon";
type Salon = {
  darDeAltaLaMesa: (clave: string, datos: FormData) => Promise<unknown>;
  cargarLasMesas: (contexto: never) => Promise<unknown>;
  cambiarElEstadoDeLaMesaDelSalon: (id: string, activa: boolean) => Promise<unknown>;
  nuevaClaveDeMesa: () => string;
};
const cargar = () => import(/* @vite-ignore */ RUTA) as Promise<Salon>;
const formulario = (extra: Record<string, string> = {}) => {
  const datos = new FormData();
  for (const [k, v] of Object.entries({
    numero: "7",
    forma: "REDONDA",
    tamano: "CHICA",
    columna: "1",
    fila: "1",
    ...extra,
  }))
    datos.set(k, v);
  return datos;
};

beforeEach(() => {
  mundo.efectiva = SUCURSAL;
  mundo.creaciones = [];
  mundo.listas = [];
});

describe("servidor del salón: mesas", () => {
  it("el alta usa la sucursal del servidor y la clave de la página; la sucursal, la empresa y el estado del formulario se descartan", async () => {
    const { darDeAltaLaMesa } = await cargar();
    const datos = formulario({
      sucursalId: "otra",
      empresaId: "otra",
      activa: "false",
      mesaId: "otra",
    });
    await expect(darDeAltaLaMesa(MESA, datos)).rejects.toThrow("REDIRECT /salon/mesas");
    expect(mundo.creaciones).toEqual([
      {
        mesaId: MESA,
        sucursalId: SUCURSAL,
        numero: 7,
        forma: "REDONDA",
        tamano: "CHICA",
        columna: 1,
        fila: 1,
      },
    ]);
  });

  it("sin sucursal efectiva no se asume «todas»: el genérico y ninguna llamada", async () => {
    mundo.efectiva = "";
    const { darDeAltaLaMesa, cargarLasMesas, cambiarElEstadoDeLaMesaDelSalon } = await cargar();
    expect(await darDeAltaLaMesa(MESA, formulario())).toEqual({
      error: errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA"),
    });
    expect(await cargarLasMesas(CONTEXTO as never)).toEqual({
      ok: false,
      error: errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA"),
    });
    expect(await cambiarElEstadoDeLaMesaDelSalon(MESA, false)).toEqual({
      error: errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA"),
    });
    expect(mundo.creaciones).toEqual([]);
    expect(mundo.listas).toEqual([]);
  });

  it("la lista pide la sucursal del servidor, con las desactivadas", async () => {
    const { cargarLasMesas } = await cargar();
    expect(await cargarLasMesas(CONTEXTO as never)).toEqual({ ok: true, dato: { mesas: [] } });
    expect(mundo.listas).toEqual([{ sucursalId: SUCURSAL, incluirInactivas: true }]);
  });

  it("la clave de creación es nueva en cada apertura de la página", async () => {
    const { nuevaClaveDeMesa } = await cargar();
    expect(nuevaClaveDeMesa()).not.toBe(nuevaClaveDeMesa());
  });
});
