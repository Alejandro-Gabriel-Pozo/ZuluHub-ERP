import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorDeCodigo } from "../../src/capacidades/experiencia/respuesta";
import { ok } from "../../src/primitivas/resultado/resultado";

/**
 * La sucursal del listado (D-34): vive en una cookie del servidor que se valida contra las sucursales que la persona puede elegir en
 * CADA pedido (y la consulta la verifica otra vez). Acá: la acción que la guarda (valida, escribe la cookie con sus opciones y relanza
 * la redirección), lo que se le pasa a la consulta del listado, y el archivo `"use server"` que la expone a Next.
 */
vi.mock("server-only", () => ({}));

const CENTRO = "11111111-1111-4111-8111-111111111111";
const NORTE = "22222222-2222-4222-8222-222222222222";
const AJENA = "33333333-3333-4333-8333-333333333333";

const mundo = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  escrituras: [] as { nombre: string; valor: string; opciones: unknown }[],
  sucursales: [] as { id: string; nombre: string; activa: boolean }[],
  sesion: true,
  mismoOrigen: true,
  listados: [] as { sucursalElegida: unknown; pedido: unknown }[],
}));

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (nombre: string) =>
        mundo.cookies.has(nombre) ? { name: nombre, value: mundo.cookies.get(nombre) } : undefined,
      set: (nombre: string, valor: string, opciones: unknown) => {
        mundo.escrituras.push({ nombre, valor, opciones });
        mundo.cookies.set(nombre, valor);
      },
    }),
}));
vi.mock("../../apps/web/servidor/acciones", () => ({
  pedidoDeLaAccion: () =>
    Promise.resolve(
      mundo.mismoOrigen
        ? { ok: true, dato: {} }
        : { ok: false, error: errorDeCodigo("SIN_PERMISO") },
    ),
}));
vi.mock("../../apps/web/servidor/sesion", () => ({
  dependenciasDeSesion: { respuesta: { registrar: () => undefined } },
  sesionDelPedido: () =>
    Promise.resolve({ sesion: mundo.sesion ? {} : null, puerta: { marcaId: "marca-1" } }),
}));
vi.mock("../../apps/web/servidor/despacho-inmediato", () => ({
  despacharPorClavesDespuesDeConfirmar: () => undefined,
}));
vi.mock("../../src/composicion/sesion-y-empresa", () => ({
  resolverEmpresa: () =>
    Promise.resolve({ ok: true, dato: { tipo: "ENTRA", contexto: { empresaId: "empresa-1" } } }),
}));
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    consultasDeEmpresas: () => ({
      sucursalesElegibles: () => Promise.resolve(ok(mundo.sucursales)),
    }),
    casosDeUsoDeFacturacion: () => ({}),
    consultasDeFacturacion: () => ({
      listarComprobantes: (_contexto: unknown, pedido: { sucursalElegida: unknown }) => {
        mundo.listados.push({ sucursalElegida: pedido.sucursalElegida, pedido });
        return Promise.resolve(ok({ items: [], siguiente: null }));
      },
    }),
  },
}));

const COOKIE = "__Host-pd_sucursal";
// Los comparadores asimétricos de Vitest devuelven `any`: acá salen tipados como `unknown`.
const conCodigo = (codigo: string): unknown => expect.objectContaining({ codigo });
const conDigest = (patron: RegExp): unknown => expect.stringMatching(patron);
const formulario = (valor?: string): FormData => {
  const datos = new FormData();
  if (valor !== undefined) datos.set("sucursalId", valor);
  return datos;
};

beforeEach(() => {
  mundo.cookies = new Map();
  mundo.escrituras = [];
  mundo.sucursales = [
    { id: CENTRO, nombre: "Centro", activa: true },
    { id: NORTE, nombre: "Norte", activa: false },
  ];
  mundo.sesion = true;
  mundo.mismoOrigen = true;
  mundo.listados = [];
});

describe("elegir la sucursal (la acción)", () => {
  it.each([
    ["abierta", CENTRO],
    ["cerrada (D-37)", NORTE],
  ])(
    "una sucursal %s de las que puede elegir: guarda la cookie y vuelve al listado",
    async (_n, id) => {
      const { elegirLaSucursal } = await import("../../apps/web/servidor/facturacion");
      // Next implementa `redirect` lanzando un error con este digest; la acción no lo atrapa.
      await expect(elegirLaSucursal(formulario(id))).rejects.toMatchObject({
        digest: conDigest(/^NEXT_REDIRECT;[a-z]+;\/facturacion\/comprobantes;/),
      });
      expect(mundo.escrituras).toEqual([
        {
          nombre: COOKIE,
          valor: id,
          opciones: { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 2_592_000 },
        },
      ]);
    },
  );

  it.each([
    ["una sucursal que no es de su alcance", AJENA],
    ["vacío (no eligió ninguna)", ""],
    ["un texto cualquiera", "todas"],
    ["un valor con espacios", ` ${CENTRO}`],
  ])("%s: error de sucursal fuera de alcance y no escribe nada", async (_n, id) => {
    const { elegirLaSucursal } = await import("../../apps/web/servidor/facturacion");
    expect(await elegirLaSucursal(formulario(id))).toEqual({
      error: conCodigo("FISCAL_SUCURSAL_FUERA_DE_ALCANCE"),
    });
    expect(mundo.escrituras).toEqual([]);
  });

  it("sin el campo del formulario, lo mismo", async () => {
    const { elegirLaSucursal } = await import("../../apps/web/servidor/facturacion");
    expect(await elegirLaSucursal(formulario())).toEqual({
      error: conCodigo("FISCAL_SUCURSAL_FUERA_DE_ALCANCE"),
    });
    expect(mundo.escrituras).toEqual([]);
  });

  it("sin sesión es «sesión vencida» y un pedido de otro origen es «sin permiso»; ninguno escribe", async () => {
    const { elegirLaSucursal } = await import("../../apps/web/servidor/facturacion");
    mundo.sesion = false;
    expect(await elegirLaSucursal(formulario(CENTRO))).toEqual({
      error: conCodigo("SESION_VENCIDA"),
    });
    mundo.sesion = true;
    mundo.mismoOrigen = false;
    expect(await elegirLaSucursal(formulario(CENTRO))).toEqual({
      error: conCodigo("SIN_PERMISO"),
    });
    expect(mundo.escrituras).toEqual([]);
  });

  it("se repite sin duplicar: elegir la misma otra vez deja la misma cookie", async () => {
    const { elegirLaSucursal } = await import("../../apps/web/servidor/facturacion");
    for (let i = 0; i < 2; i += 1) {
      await expect(elegirLaSucursal(formulario(CENTRO))).rejects.toBeDefined();
    }
    expect(mundo.cookies.get(COOKIE)).toBe(CENTRO);
    expect(mundo.cookies.size).toBe(1);
  });
});

describe("qué sucursal se le pasa a la consulta del listado", () => {
  it("la de la cookie si sigue siendo de las que puede elegir (abierta o cerrada)", async () => {
    const { listarLosComprobantes } = await import("../../apps/web/servidor/facturacion");
    mundo.cookies.set(COOKIE, NORTE);
    expect((await listarLosComprobantes()).ok).toBe(true);
    expect(mundo.listados[0]?.sucursalElegida).toBe(NORTE);
  });

  it.each([
    ["sin cookie", undefined],
    ["una cookie de otra empresa o ajena", AJENA],
    ["una cookie con basura", "' or 1=1 --"],
    ["una cookie vacía", ""],
  ])("%s: no se pasa ninguna (la decide el servidor)", async (_n, valor) => {
    const { listarLosComprobantes } = await import("../../apps/web/servidor/facturacion");
    if (valor !== undefined) mundo.cookies.set(COOKIE, valor);
    await listarLosComprobantes();
    expect(mundo.listados[0]?.sucursalElegida).toBeNull();
  });

  it("el navegador no puede mandar la sucursal en el pedido del listado", async () => {
    const { listarLosComprobantes } = await import("../../apps/web/servidor/facturacion");
    await listarLosComprobantes({ sucursalElegida: AJENA, sucursalId: AJENA });
    expect(mundo.listados[0]?.sucursalElegida).toBeNull();
  });
});

describe("la sucursal con la que trabaja la pantalla", () => {
  it("elegida: esa; sin elegir con una sola abierta: esa (D-36); con varias abiertas: ninguna", async () => {
    const { cargarElListado } = await import("../../apps/web/servidor/facturacion");
    const contexto = { empresaId: "empresa-1" } as never;
    mundo.cookies.set(COOKIE, NORTE);
    expect((await cargarElListado(contexto, () => ({}))).efectiva).toBe(NORTE);
    mundo.cookies.clear();
    // Centro abierta y Norte cerrada: se toma Centro sola.
    expect((await cargarElListado(contexto, () => ({}))).efectiva).toBe(CENTRO);
    mundo.sucursales = [
      { id: CENTRO, nombre: "Centro", activa: true },
      { id: NORTE, nombre: "Norte", activa: true },
    ];
    expect((await cargarElListado(contexto, () => ({}))).efectiva).toBe("");
  });

  it("devuelve las sucursales, los puntos de venta (ninguno por ahora) y la página que dio la consulta", async () => {
    const { cargarElListado } = await import("../../apps/web/servidor/facturacion");
    const pedidos: unknown[] = [];
    const cargado = await cargarElListado({ empresaId: "empresa-1" } as never, (puntosDeVenta) => {
      pedidos.push(puntosDeVenta);
      return { estado: "RECHAZADO" };
    });
    expect(cargado.sucursales.map((s) => s.nombre)).toEqual(["Centro", "Norte"]);
    expect(cargado.puntosDeVenta).toEqual([]);
    expect(pedidos).toEqual([[]]);
    expect(cargado.pagina).toEqual({ ok: true, dato: { items: [], siguiente: null } });
    expect(mundo.listados[0]?.pedido).toMatchObject({ estado: "RECHAZADO" });
  });
});

describe("el archivo «use server» que la expone", () => {
  const ARCHIVO = "apps/web/app/s/app/acciones-de-sucursal.ts";

  it("la directiva va primero y solo exporta una función asíncrona", async () => {
    expect(readFileSync(ARCHIVO, "utf8").startsWith('"use server";')).toBe(true);
    const acciones = await import("../../apps/web/app/s/app/acciones-de-sucursal");
    expect(Object.keys(acciones)).toEqual(["elegirSucursalAccion"]);
    expect(acciones.elegirSucursalAccion.constructor.name).toBe("AsyncFunction");
  });

  it("delega en la acción del servidor con el formulario tal cual", async () => {
    const { elegirSucursalAccion } = await import("../../apps/web/app/s/app/acciones-de-sucursal");
    expect(await elegirSucursalAccion({ error: null }, formulario(AJENA))).toEqual({
      error: conCodigo("FISCAL_SUCURSAL_FUERA_DE_ALCANCE"),
    });
  });
});
