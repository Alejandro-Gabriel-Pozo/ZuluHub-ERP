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
    mapas: Record<string, unknown>[];
    agregados: Record<string, unknown>[];
    cuentaDelMapa: string | null;
  } => ({
    efectiva: "",
    creaciones: [],
    listas: [],
    mapas: [],
    agregados: [],
    cuentaDelMapa: null,
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
      agregarAlPedido: (_c: unknown, entrada: Record<string, unknown>) => {
        mundo.agregados.push(entrada);
        return Promise.resolve({
          ok: true,
          valor: {
            posicion: 1,
            precioUnitario: { moneda: "ARS", monto: "1000.000000" },
            totalProvisorio: { moneda: "ARS", monto: "1000.00" },
            yaExistia: false,
            extra: "no sale",
          },
        });
      },
      reactivarMesa: () =>
        Promise.resolve({ ok: true, valor: { mesaId: MESA, version: 3, yaExistia: false } }),
    }),
    consultasDeSalon: () => ({
      listarMesas: (_c: unknown, entrada: Record<string, unknown>) => {
        mundo.listas.push(entrada);
        return Promise.resolve({ ok: true, valor: [] });
      },
      mapaDeMesas: (_c: unknown, entrada: Record<string, unknown>) => {
        mundo.mapas.push(entrada);
        return Promise.resolve({
          ok: true,
          valor:
            mundo.cuentaDelMapa === null ? [] : [{ mesaId: MESA, cuentaId: mundo.cuentaDelMapa }],
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

const RUTA = "../../apps/web/servidor/salon";
type Salon = {
  darDeAltaLaMesa: (clave: string, datos: FormData) => Promise<unknown>;
  cargarLasMesas: (contexto: never) => Promise<unknown>;
  cambiarElEstadoDeLaMesaDelSalon: (id: string, activa: boolean) => Promise<unknown>;
  cargarElMapaDeMesas: (crudo?: unknown) => Promise<unknown>;
  agregarAlPedidoDeLaMesaDelSalon: (crudo: unknown) => Promise<unknown>;
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
  mundo.mapas = [];
  mundo.agregados = [];
  mundo.cuentaDelMapa = null;
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

describe("servidor del salón: mapa de mesas (SAL-A)", () => {
  it("el mapa pide la sucursal del servidor; sin filtro es «Todas»", async () => {
    const { cargarElMapaDeMesas } = await cargar();
    expect(await cargarElMapaDeMesas()).toEqual({ ok: true, dato: { mesas: [] } });
    expect(mundo.mapas).toEqual([{ sucursalId: SUCURSAL, filtro: "TODAS" }]);
  });

  it("la sucursal y la empresa que traiga el pedido del navegador se descartan; el filtro pasa solo si es de la lista", async () => {
    const { cargarElMapaDeMesas } = await cargar();
    await cargarElMapaDeMesas({ filtro: "LIBRES", sucursalId: "otra", empresaId: "otra" });
    expect(mundo.mapas).toEqual([{ sucursalId: SUCURSAL, filtro: "LIBRES" }]);
  });

  it("un filtro que no existe cierra con el genérico y no llama a la consulta", async () => {
    const { cargarElMapaDeMesas } = await cargar();
    expect(await cargarElMapaDeMesas({ filtro: "TODAS_LAS_SUCURSALES" })).toEqual({
      ok: false,
      error: errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA"),
    });
    expect(mundo.mapas).toEqual([]);
  });

  it("sin sucursal efectiva no se asume «todas»: el genérico y ninguna llamada", async () => {
    mundo.efectiva = "";
    const { cargarElMapaDeMesas } = await cargar();
    expect(await cargarElMapaDeMesas({ filtro: "LIBRES" })).toEqual({
      ok: false,
      error: errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA"),
    });
    expect(mundo.mapas).toEqual([]);
  });

  it("dos sucursales: cada pedido trae la suya, nunca la del otro", async () => {
    const { cargarElMapaDeMesas } = await cargar();
    const OTRA = "44444444-4444-4444-8444-444444444444";
    await cargarElMapaDeMesas();
    mundo.efectiva = OTRA;
    await cargarElMapaDeMesas();
    expect(mundo.mapas.map((m) => m["sucursalId"])).toEqual([SUCURSAL, OTRA]);
  });
});

describe("servidor del salón: agregar al pedido (SAL-B)", () => {
  const CUENTA = "55555555-5555-4555-8555-555555555555";
  const LINEA = "66666666-6666-4666-8666-666666666666";
  const PRODUCTO = "77777777-7777-4777-8777-777777777777";
  const pedido = (extra: Record<string, unknown> = {}) => ({
    cuentaId: CUENTA,
    lineaId: LINEA,
    productoId: PRODUCTO,
    opcionIds: [],
    cantidad: "2",
    ...extra,
  });

  it("la línea lleva el id de la página y solo lo declarado; el precio, el total, la sucursal y la persona del navegador se descartan, y solo sale lo declarado", async () => {
    mundo.cuentaDelMapa = CUENTA;
    const { agregarAlPedidoDeLaMesaDelSalon } = await cargar();
    const r = await agregarAlPedidoDeLaMesaDelSalon(
      pedido({
        salida: "DESPUES",
        precioUnitario: { moneda: "ARS", monto: "1.00" },
        sucursalId: "otra",
        personaId: "otra",
      }),
    );
    expect(mundo.agregados).toEqual([
      {
        cuentaId: CUENTA,
        lineaId: LINEA,
        productoId: PRODUCTO,
        opcionIds: [],
        cantidad: "2",
        salida: "DESPUES",
      },
    ]);
    expect(mundo.mapas).toEqual([{ sucursalId: SUCURSAL, filtro: "TODAS" }]);
    expect(r).toEqual({
      ok: true,
      dato: {
        posicion: 1,
        precioUnitario: { moneda: "ARS", monto: "1000.000000" },
        totalProvisorio: { moneda: "ARS", monto: "1000.00" },
        yaExistia: false,
      },
    });
  });

  it("la cantidad es texto: un número, un id inválido o una salida inexistente son el genérico y no llaman al caso de uso", async () => {
    mundo.cuentaDelMapa = CUENTA;
    const { agregarAlPedidoDeLaMesaDelSalon } = await cargar();
    const generico = { ok: false, error: errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA") };
    for (const malo of [
      pedido({ cantidad: 2 }),
      pedido({ lineaId: "x" }),
      pedido({ salida: "NUNCA" }),
      pedido({ opcionIds: "no-es-lista" }),
      undefined,
    ]) {
      expect(await agregarAlPedidoDeLaMesaDelSalon(malo)).toEqual(generico);
    }
    expect(mundo.agregados).toEqual([]);
  });

  it("una cuenta que no figura en el mapa de la sucursal, o sin sucursal efectiva, es el genérico y no escribe", async () => {
    const { agregarAlPedidoDeLaMesaDelSalon } = await cargar();
    const generico = { ok: false, error: errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA") };
    mundo.cuentaDelMapa = "88888888-8888-4888-8888-888888888888";
    expect(await agregarAlPedidoDeLaMesaDelSalon(pedido())).toEqual(generico);
    mundo.cuentaDelMapa = CUENTA;
    mundo.efectiva = "";
    expect(await agregarAlPedidoDeLaMesaDelSalon(pedido())).toEqual(generico);
    expect(mundo.agregados).toEqual([]);
  });
});
