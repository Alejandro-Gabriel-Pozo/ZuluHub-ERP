import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorDeCodigo } from "../../src/capacidades/experiencia/respuesta";

/**
 * `apps/web/servidor/comandas.ts`: la sucursal la fija el SERVIDOR (la efectiva del dispositivo) y del pedido del navegador solo se toman las claves declaradas (nunca la sucursal ni el rótulo del papel). Sin
 * sucursal (`efectiva` vacía) no se asume «todas»: cierra con el genérico y no llama a ningún caso de uso. La composición es la real (`src/composicion/comandas-web.ts`); las consultas y los casos de uso son
 * falsos (con la base real se prueban en `test/integracion/comandas-web.test.ts`).
 * Previene: enviar, anular o imprimir en una sucursal que la persona no eligió, o en «todas», porque lo dijo el navegador o porque no había ninguna elegida.
 */
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
const CONTEXTO = { empresaId: "empresa-de-la-sesion" };
const SUCURSAL = "33333333-3333-4333-8333-333333333333";
const CUENTA = "11111111-1111-4111-8111-111111111111";
const ENVIO = "22222222-2222-4222-8222-222222222222";
const CLAVE = "clave-abcdefghijklmnop";
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
    casosDeUsoDeSalon: () => ({
      enviarACocina: registrar("enviarACocina", {
        envioId: "22222222-2222-4222-8222-222222222222",
        numero: 1,
        tipo: "ENVIO",
        lineas: 1,
        trabajoId: "t",
        sinImpresora: true,
        ignoradas: [],
        yaExistia: false,
        enviadoEn: new Date(),
      }),
      pedirQueSalga: registrar("pedirQueSalga", {}),
      anularItemEnviado: registrar("anularItemEnviado", {}),
    }),
    casosDeUsoDeComandas: () => ({
      cambiarSalida: registrar("cambiarSalida", { salida: "DESPUES", yaEstaba: false }),
      registrarImpresora: registrar("registrarImpresora", {
        impresoraId: "i",
        version: 1,
        yaExistia: false,
      }),
      editarImpresora: registrar("editarImpresora", {
        impresoraId: "i",
        version: 2,
        yaExistia: false,
      }),
      desactivarImpresora: registrar("desactivarImpresora", { yaEstabaDesactivada: false }),
      solicitarImpresion: registrar("solicitarImpresion", {}),
      solicitarCopia: registrar("solicitarCopia", {}),
      declararResultadoDeImpresion: registrar("declararResultadoDeImpresion", {}),
    }),
    consultasDeComandas: () => ({
      impresorasDeLaSucursal: (_c: unknown, entrada: Record<string, unknown>) => {
        mundo.llamadas.push({ caso: "impresorasDeLaSucursal", entrada });
        return Promise.resolve({ ok: true, valor: [] });
      },
      trabajosDeImpresion: () => Promise.resolve({ ok: true, valor: [] }),
      documentoParaImprimir: () => Promise.resolve({ ok: true, valor: { ancho: 80, lineas: [] } }),
    }),
    consultasDeSalon: () => ({
      mapaDeMesas: (_c: unknown, entrada: Record<string, unknown>) => {
        mundo.llamadas.push({ caso: "mapaDeMesas", entrada });
        return Promise.resolve({
          ok: true,
          valor: [{ mesaId: "m", cuentaId: "11111111-1111-4111-8111-111111111111" }],
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
vi.mock("../../apps/web/servidor/sucursal-elegida", () => ({
  sucursalDelPedido: () =>
    Promise.resolve({ ok: true, dato: { elegida: null, efectiva: mundo.efectiva } }),
}));

const RUTA = "../../apps/web/servidor/comandas";
type Accion = (crudo: unknown) => Promise<unknown>;
type Comandas = {
  nuevoIdDeIntento: () => string;
  enviarLaCuentaALaCocina: Accion;
  cambiarElOrdenDeSalida: Accion;
  darDeAltaLaImpresora: Accion;
  guardarLaImpresora: Accion;
  desactivarLaImpresoraDelSalon: Accion;
  imprimirElDocumento: Accion;
  declararSiSeImprimio: Accion;
  cargarElPapelDelDocumento: Accion;
  cargarLasImpresoras: (contexto: never) => Promise<unknown>;
};
const cargar = () => import(/* @vite-ignore */ RUTA) as Promise<Comandas>;
const GENERICO = { ok: false, error: errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA") };

beforeEach(() => {
  mundo.efectiva = SUCURSAL;
  mundo.llamadas = [];
});

describe("servidor de comandas", () => {
  it("enviar: el pedido lleva el id y la clave de la página; la sucursal, la persona y el rótulo del navegador se descartan", async () => {
    const { enviarLaCuentaALaCocina } = await cargar();
    const r = await enviarLaCuentaALaCocina({
      envioId: ENVIO,
      cuentaId: CUENTA,
      claveIdempotencia: CLAVE,
      sucursalId: "otra",
      rotulo: "Mesa 99",
      personaId: "otra",
    });
    expect(r).toMatchObject({ ok: true, dato: { numero: 1 } });
    // La sucursal de la consulta que valida la cuenta es la del servidor.
    expect(mundo.llamadas.find((l) => l.caso === "mapaDeMesas")?.entrada).toMatchObject({
      sucursalId: SUCURSAL,
    });
    expect(mundo.llamadas.find((l) => l.caso === "enviarACocina")?.entrada).toEqual({
      envioId: ENVIO,
      cuentaId: CUENTA,
      claveIdempotencia: CLAVE,
    });
    // Nada de lo que no se declaró sale hacia la pantalla.
    expect(Object.keys((r as { dato: object }).dato)).not.toContain("enviadoEn");
  });

  it("sin sucursal efectiva no se asume «todas»: el genérico y ninguna llamada, en cada operación", async () => {
    mundo.efectiva = "";
    const c = await cargar();
    for (const accion of [
      c.enviarLaCuentaALaCocina,
      c.cambiarElOrdenDeSalida,
      c.darDeAltaLaImpresora,
      c.guardarLaImpresora,
      c.desactivarLaImpresoraDelSalon,
      c.imprimirElDocumento,
      c.declararSiSeImprimio,
      c.cargarElPapelDelDocumento,
    ]) {
      expect(await accion({ cuentaId: CUENTA })).toEqual(GENERICO);
    }
    expect(await c.cargarLasImpresoras(CONTEXTO as never)).toEqual(GENERICO);
    expect(mundo.llamadas).toEqual([]);
  });

  it("el alta de impresora pone la sucursal del servidor y descarta la del navegador", async () => {
    const { darDeAltaLaImpresora } = await cargar();
    await darDeAltaLaImpresora({
      impresoraId: ENVIO,
      nombre: "Cocina",
      uso: "COMANDA",
      papelMm: 80,
      sucursalId: "otra",
    });
    expect(mundo.llamadas.find((l) => l.caso === "registrarImpresora")?.entrada).toEqual({
      impresoraId: ENVIO,
      nombre: "Cocina",
      uso: "COMANDA",
      papelMm: 80,
      sucursalId: SUCURSAL,
    });
  });

  it("la lista de impresoras pide la sucursal del servidor, con las desactivadas", async () => {
    const { cargarLasImpresoras } = await cargar();
    expect(await cargarLasImpresoras(CONTEXTO as never)).toEqual({
      ok: true,
      dato: { impresoras: [] },
    });
    expect(mundo.llamadas).toEqual([
      { caso: "impresorasDeLaSucursal", entrada: { sucursalId: SUCURSAL, incluirInactivas: true } },
    ]);
  });

  it("un pedido mal formado es el genérico y no llama a ningún caso de uso", async () => {
    const { enviarLaCuentaALaCocina, imprimirElDocumento } = await cargar();
    expect(
      await enviarLaCuentaALaCocina({ envioId: "x", cuentaId: CUENTA, claveIdempotencia: CLAVE }),
    ).toEqual(GENERICO);
    expect(await imprimirElDocumento(undefined)).toEqual(GENERICO);
    expect(mundo.llamadas.filter((l) => l.caso !== "mapaDeMesas")).toEqual([]);
  });

  it("cada intento tiene su id: dos llamadas dan ids distintos y con forma de id", async () => {
    const { nuevoIdDeIntento } = await cargar();
    const a = nuevoIdDeIntento();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(nuevoIdDeIntento()).not.toBe(a);
  });
});
