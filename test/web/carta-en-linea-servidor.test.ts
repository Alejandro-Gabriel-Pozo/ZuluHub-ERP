import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El servidor de «Carta en línea» (`apps/web/servidor/carta-en-linea.ts`): de lo que manda el formulario a lo que pide a la composición. De la identidad solo lee cara, paleta, color propio y logo, como TEXTO; lo que
 * el formulario no trae (o trae como archivo) llega como `undefined` (conserva lo vigente) y lo vacío llega vacío (lo deja «sin elegir»). La empresa, la persona y la sucursal las fija el servidor. La forma y el valor
 * de cada dato los decide la composición (`entradas-de-carta-en-linea.test.ts`), no esta capa.
 */
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const mundo = vi.hoisted(() => ({
  pedidos: [] as unknown[][],
  sucursal: "5c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f",
}));
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: { casosDeUsoDeCatalogo: () => ({}), consultasDeCatalogo: () => ({}) },
}));
vi.mock("../../apps/web/servidor/sesion", () => ({ dependenciasDeSesion: { respuesta: {} } }));
vi.mock("../../apps/web/servidor/con-la-empresa", () => ({
  conLaEmpresa: (hacer: (contexto: unknown) => Promise<unknown>) => hacer({ empresaId: "e1" }),
}));
vi.mock("../../apps/web/servidor/sucursal-elegida", () => ({
  sucursalDelPedido: () => Promise.resolve({ ok: true, dato: { efectiva: mundo.sucursal } }),
}));
vi.mock("../../src/composicion/carta-en-linea-web", () => ({
  guardarLaCartaEnLinea: (...args: unknown[]) => {
    mundo.pedidos.push(args);
    return Promise.resolve({ ok: true, dato: {} });
  },
  cambiarElEstadoDeLaCartaEnLinea: vi.fn(),
  verLaCartaEnLinea: vi.fn(),
}));

import { guardarLosTextosDeLaCarta } from "../../apps/web/servidor/carta-en-linea";

const LIGADO = { cartaId: "c-1", sucursalId: mundo.sucursal, versionEsperada: 3 };
const crudoDe = () => mundo.pedidos[0]?.[2] as Record<string, unknown>;

describe("guardarLosTextosDeLaCarta: del formulario al pedido", () => {
  beforeEach(() => {
    mundo.pedidos = [];
  });

  it("pasa los tres textos y la identidad como texto, con lo ligado por la página y la sucursal del servidor", async () => {
    const datos = new FormData();
    datos.set("nombre", "Parador");
    datos.set("rubro", "Parrilla");
    datos.set("lugar", "Huinganco");
    datos.set("cara", "NOCHE");
    datos.set("paleta", "otro");
    datos.set("colorPropio", "#0e7490");
    datos.set("logo", "https://res.cloudinary.com/demo/image/upload/v1/x.png");
    expect(await guardarLosTextosDeLaCarta(LIGADO, datos)).toEqual({ error: null });
    expect(crudoDe()).toEqual({
      ...LIGADO,
      nombre: "Parador",
      rubro: "Parrilla",
      lugar: "Huinganco",
      cara: "NOCHE",
      paleta: "otro",
      colorPropio: "#0e7490",
      logo: "https://res.cloudinary.com/demo/image/upload/v1/x.png",
    });
    expect(mundo.pedidos[0]?.[3]).toBe(mundo.sucursal);
  });

  it("lo que el formulario no trae (o trae como archivo) llega como `undefined`; lo vacío, vacío", async () => {
    const datos = new FormData();
    datos.set("nombre", "Parador");
    datos.set("cara", new Blob(["x"]), "cara.txt");
    datos.set("logo", "");
    await guardarLosTextosDeLaCarta(LIGADO, datos);
    const crudo = crudoDe();
    expect(crudo["cara"]).toBeUndefined();
    expect(crudo["paleta"]).toBeUndefined();
    expect(crudo["colorPropio"]).toBeUndefined();
    expect(crudo["logo"]).toBe("");
  });

  it("no pasa nada más del formulario: ni la empresa, ni el estado, ni el modelo, ni el código", async () => {
    const datos = new FormData();
    datos.set("nombre", "Parador");
    datos.set("empresaId", "otra");
    datos.set("estado", "EN_LINEA");
    datos.set("modelo", "LIBRO");
    datos.set("codigo", "ABC");
    await guardarLosTextosDeLaCarta(LIGADO, datos);
    expect(Object.keys(crudoDe()).sort()).toEqual(
      [
        "cartaId",
        "sucursalId",
        "versionEsperada",
        "nombre",
        "rubro",
        "lugar",
        "cara",
        "paleta",
        "colorPropio",
        "logo",
      ].sort(),
    );
  });
});
