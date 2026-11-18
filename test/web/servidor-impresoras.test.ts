import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorDeCodigo } from "../../src/capacidades/experiencia/respuesta";

/**
 * `apps/web/servidor/impresoras.ts` (pantalla «Impresoras», S-2): del formulario solo se toman los tres campos declarados (nombre, uso, papel); la sucursal la fija el SERVIDOR y la del navegador se descarta; el alta
 * lleva el id que fijó la página (dos envíos con el mismo id son UNA impresora); «Quitar» desactiva y nunca borra; una impresora ajena, desactivada o inexistente es el genérico. Sin sucursal efectiva no se asume
 * «todas»: cierra con el genérico y no escribe. La composición es la real; las consultas y los casos de uso son falsos (con la base real se prueban en `test/integracion/comandas-web.test.ts`).
 * Previene: crear o quitar una impresora en una sucursal que la persona no eligió, o duplicarla por un doble toque.
 */
vi.mock("server-only", () => ({}));
const revalidar = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: revalidar }));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`REDIRECT:${destino}`);
  },
}));
const CONTEXTO = { empresaId: "empresa-de-la-sesion" };
const SUCURSAL = "33333333-3333-4333-8333-333333333333";
const ACTIVA = "11111111-1111-4111-8111-111111111111";
const DESACTIVADA = "22222222-2222-4222-8222-222222222222";
const mundo = vi.hoisted(
  (): { efectiva: string; llamadas: { caso: string; entrada: Record<string, unknown> }[] } => ({
    efectiva: "",
    llamadas: [],
  }),
);
const registrar =
  (caso: string, valor: unknown) => (_contexto: unknown, entrada: Record<string, unknown>) => {
    mundo.llamadas.push({ caso, entrada });
    return Promise.resolve({ ok: true, valor });
  };
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    casosDeUsoDeSalon: () => ({}),
    casosDeUsoDeComandas: () => ({
      cambiarSalida: registrar("cambiarSalida", {}),
      registrarImpresora: registrar("registrarImpresora", {
        impresoraId: ACTIVA,
        version: 1,
        yaExistia: false,
      }),
      editarImpresora: registrar("editarImpresora", {
        impresoraId: ACTIVA,
        version: 2,
        yaExistia: false,
      }),
      desactivarImpresora: registrar("desactivarImpresora", { yaEstabaDesactivada: false }),
    }),
    consultasDeComandas: () => ({
      impresorasDeLaSucursal: (_c: unknown, entrada: Record<string, unknown>) => {
        mundo.llamadas.push({ caso: "impresorasDeLaSucursal", entrada });
        return Promise.resolve({
          ok: true,
          valor: [
            { id: ACTIVA, nombre: "Cocina", uso: "COMANDA", papelMm: 80, activa: true, version: 1 },
            {
              id: DESACTIVADA,
              nombre: "Vieja",
              uso: "TICKET",
              papelMm: 58,
              activa: false,
              version: 3,
            },
          ],
        });
      },
    }),
    consultasDeSalon: () => ({}),
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

const RUTA = "../../apps/web/servidor/impresoras";
type Modulo = {
  cargarLaImpresora: (contexto: never, id: string) => Promise<unknown>;
  agregarLaImpresora: (id: string, datos: FormData) => Promise<unknown>;
  cambiarLaImpresora: (id: string, version: number, datos: FormData) => Promise<unknown>;
  quitarLaImpresora: (id: string) => Promise<unknown>;
};
const cargar = () => import(/* @vite-ignore */ RUTA) as Promise<Modulo>;
const GENERICO = { ok: false, error: errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA") };
const formulario = (extra: Record<string, string> = {}) => {
  const datos = new FormData();
  for (const [k, v] of Object.entries({
    nombre: "Cocina",
    uso: "COMANDA",
    papelMm: "80",
    ...extra,
  }))
    datos.set(k, v);
  return datos;
};
const llamada = (caso: string) => mundo.llamadas.find((l) => l.caso === caso)?.entrada;

beforeEach(() => {
  mundo.efectiva = SUCURSAL;
  mundo.llamadas = [];
  revalidar.mockClear();
});

describe("servidor de impresoras", () => {
  it("el alta toma solo los tres campos y el id de la página; la sucursal es la del servidor y la del navegador se descarta; guarda y vuelve a la lista", async () => {
    const { agregarLaImpresora } = await cargar();
    await expect(
      agregarLaImpresora(ACTIVA, formulario({ sucursalId: "otra", empresaId: "otra" })),
    ).rejects.toThrow("REDIRECT:/salon/impresoras");
    expect(llamada("registrarImpresora")).toEqual({
      impresoraId: ACTIVA,
      nombre: "Cocina",
      uso: "COMANDA",
      papelMm: 80,
      sucursalId: SUCURSAL,
    });
  });

  it("IDEMPOTENCIA: guardar dos veces con el mismo id llega las dos veces con el mismo id (la base lo deja en una sola impresora)", async () => {
    const { agregarLaImpresora } = await cargar();
    for (let i = 0; i < 2; i++)
      await expect(agregarLaImpresora(ACTIVA, formulario())).rejects.toThrow("REDIRECT");
    const ids = mundo.llamadas
      .filter((l) => l.caso === "registrarImpresora")
      .map((l) => l.entrada["impresoraId"]);
    expect(ids).toEqual([ACTIVA, ACTIVA]);
  });

  it("editar lleva la versión que se vio y el servidor la valida contra la sucursal", async () => {
    const { cambiarLaImpresora } = await cargar();
    await expect(cambiarLaImpresora(ACTIVA, 1, formulario({ nombre: "Cocina 2" }))).rejects.toThrow(
      "REDIRECT:/salon/impresoras",
    );
    expect(llamada("editarImpresora")).toEqual({
      impresoraId: ACTIVA,
      versionEsperada: 1,
      nombre: "Cocina 2",
      uso: "COMANDA",
      papelMm: 80,
    });
  });

  it("editar una impresora que no es de la sucursal es el genérico y no escribe", async () => {
    const { cambiarLaImpresora } = await cargar();
    const ajena = "44444444-4444-4444-8444-444444444444";
    expect(await cambiarLaImpresora(ajena, 1, formulario())).toEqual({
      error: GENERICO.error,
    });
    expect(llamada("editarImpresora")).toBeUndefined();
  });

  it("«Quitar» desactiva (nunca borra), pide la lista de nuevo y repetirlo es éxito", async () => {
    const { quitarLaImpresora } = await cargar();
    expect(await quitarLaImpresora(ACTIVA)).toEqual({ error: null });
    expect(await quitarLaImpresora(ACTIVA)).toEqual({ error: null });
    expect(llamada("desactivarImpresora")).toEqual({ impresoraId: ACTIVA });
    expect(revalidar).toHaveBeenCalledWith("/salon/impresoras");
  });

  it("una impresora desactivada, ajena o inexistente es el genérico al abrir su edición; una activa de la sucursal se entrega", async () => {
    const { cargarLaImpresora } = await cargar();
    expect(await cargarLaImpresora(CONTEXTO as never, DESACTIVADA)).toEqual(GENERICO);
    expect(
      await cargarLaImpresora(CONTEXTO as never, "44444444-4444-4444-8444-444444444444"),
    ).toEqual(GENERICO);
    expect(await cargarLaImpresora(CONTEXTO as never, ACTIVA)).toMatchObject({
      ok: true,
      dato: { id: ACTIVA, nombre: "Cocina", version: 1 },
    });
    expect(llamada("impresorasDeLaSucursal")).toEqual({
      sucursalId: SUCURSAL,
      incluirInactivas: true,
    });
  });

  it("sin sucursal efectiva no se asume «todas»: el genérico y ninguna escritura", async () => {
    mundo.efectiva = "";
    const m = await cargar();
    expect(await m.agregarLaImpresora(ACTIVA, formulario())).toEqual({ error: GENERICO.error });
    expect(await m.cambiarLaImpresora(ACTIVA, 1, formulario())).toEqual({ error: GENERICO.error });
    expect(await m.quitarLaImpresora(ACTIVA)).toEqual({ error: GENERICO.error });
    expect(await m.cargarLaImpresora(CONTEXTO as never, ACTIVA)).toEqual(GENERICO);
    expect(mundo.llamadas).toEqual([]);
  });

  it("una forma mal escrita (papel con letras) es el genérico y no llama al caso de uso", async () => {
    const { agregarLaImpresora } = await cargar();
    expect(await agregarLaImpresora(ACTIVA, formulario({ papelMm: "ochenta" }))).toEqual({
      error: GENERICO.error,
    });
    expect(llamada("registrarImpresora")).toBeUndefined();
  });
});
