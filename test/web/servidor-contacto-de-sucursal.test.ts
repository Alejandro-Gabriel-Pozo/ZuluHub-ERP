import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorDeCodigo } from "../../src/capacidades/experiencia/respuesta";

/**
 * `apps/web/servidor/contacto-de-sucursal.ts`: la sucursal la fija el SERVIDOR (la elegida del dispositivo) y del pedido del navegador
 * solo se toman la versión y los tres datos. La composición es la real (`src/composicion/contacto-de-sucursal-web.ts`); las
 * consultas y el caso de uso son falsos (con la base real se prueban en `test/integracion/sucursales-contacto-web.test.ts`).
 * Previene: editar el contacto de una sucursal que la persona no eligió o de otra empresa porque lo dijo el navegador.
 */
vi.mock("server-only", () => ({}));
const CONTEXTO = { empresaId: "empresa-de-la-sesion" };
const ID = "11111111-1111-4111-8111-111111111111";
const OTRA = "22222222-2222-4222-8222-222222222222";
const mundo = vi.hoisted(
  (): {
    elegida: string | null;
    efectiva: string;
    sinSucursalDelPedido: boolean;
    elegibles: { id: string; activa: boolean }[];
    permitido: boolean;
    ediciones: Record<string, unknown>[];
    fichas: unknown[];
    error: unknown;
  } => ({
    elegida: null,
    efectiva: "",
    sinSucursalDelPedido: false,
    elegibles: [],
    permitido: true,
    ediciones: [],
    fichas: [],
    error: null,
  }),
);
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    casosDeUsoDeEmpresas: () => ({
      editarSucursal: (_c: unknown, entrada: Record<string, unknown>) => {
        mundo.ediciones.push(entrada);
        if (!mundo.permitido) return Promise.resolve({ ok: false, error: "SIN_PERMISO" });
        if (mundo.error !== null) return Promise.resolve({ ok: false, error: mundo.error });
        return Promise.resolve({ ok: true, valor: { version: 4 } });
      },
    }),
    consultasDeEmpresas: () => ({
      sucursalesElegibles: () =>
        Promise.resolve({ ok: true, valor: mundo.elegibles.map((s) => ({ ...s, nombre: "x" })) }),
      fichaDeSucursal: (_c: unknown, pedido: { sucursalId: string }) => {
        mundo.fichas.push(pedido);
        if (!mundo.permitido) return Promise.resolve({ ok: false, error: "SIN_PERMISO" });
        return Promise.resolve({
          ok: true,
          valor: {
            id: pedido.sucursalId,
            nombre: "Casa central",
            activa: true,
            horaDeCorte: "00:00",
            contacto: { telefono: "+54 11 4321-0000", correo: null, web: null },
            version: 3,
          },
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
vi.mock("../../apps/web/servidor/facturacion", () => ({
  conLaEmpresa: (hacer: (contexto: unknown) => unknown) => hacer(CONTEXTO),
}));
vi.mock("../../apps/web/servidor/sucursal-elegida", () => ({
  sucursalDelPedido: () =>
    Promise.resolve(
      mundo.sinSucursalDelPedido
        ? { ok: false, error: errorDeCodigo("SIN_PERMISO") }
        : { ok: true, dato: { elegida: mundo.elegida, efectiva: mundo.efectiva } },
    ),
}));

import {
  cargarElContactoDeLaSucursal,
  guardarElContactoDeLaSucursal,
} from "../../apps/web/servidor/contacto-de-sucursal";

beforeEach(() => {
  Object.assign(mundo, {
    elegida: ID,
    efectiva: ID,
    sinSucursalDelPedido: false,
    elegibles: [{ id: ID, activa: true }],
    permitido: true,
    ediciones: [],
    fichas: [],
    error: null,
  });
});

describe("la ficha del contacto", () => {
  it("pide la de la sucursal elegida en el dispositivo y entrega solo id, nombre, contacto y versión", async () => {
    expect(await cargarElContactoDeLaSucursal(CONTEXTO as never)).toEqual({
      ok: true,
      dato: {
        id: ID,
        nombre: "Casa central",
        contacto: { telefono: "+54 11 4321-0000", correo: null, web: null },
        version: 3,
      },
    });
    expect(mundo.fichas).toEqual([{ sucursalId: ID }]);
  });

  it("con varias para elegir y ninguna elegida: «Elegí una sucursal.» y no se lee ninguna ficha", async () => {
    mundo.elegida = null;
    mundo.elegibles = [
      { id: ID, activa: true },
      { id: OTRA, activa: true },
    ];
    expect(await cargarElContactoDeLaSucursal(CONTEXTO as never)).toMatchObject({
      ok: false,
      error: { codigo: "FISCAL_SUCURSAL_NO_ELEGIDA" },
    });
    expect(mundo.fichas).toEqual([]);
  });

  it("con una sola abierta y ninguna elegida: la toma el servidor", async () => {
    mundo.elegida = null;
    expect((await cargarElContactoDeLaSucursal(CONTEXTO as never)).ok).toBe(true);
    expect(mundo.fichas).toEqual([{ sucursalId: ID }]);
  });

  it("una elegida que ya no está entre las del alcance: fuera de alcance", async () => {
    mundo.elegida = OTRA;
    expect(await cargarElContactoDeLaSucursal(CONTEXTO as never)).toMatchObject({
      ok: false,
      error: { codigo: "FISCAL_SUCURSAL_FUERA_DE_ALCANCE" },
    });
  });

  it("sin permiso: el rechazo del servidor, sin ficha", async () => {
    mundo.permitido = false;
    expect(await cargarElContactoDeLaSucursal(CONTEXTO as never)).toMatchObject({ ok: false });
  });

  it("si falla la sucursal del pedido, responde ese error", async () => {
    mundo.sinSucursalDelPedido = true;
    expect(await cargarElContactoDeLaSucursal(CONTEXTO as never)).toMatchObject({
      ok: false,
      error: { codigo: "SIN_PERMISO" },
    });
    expect(mundo.fichas).toEqual([]);
  });
});

/** Lo que arma la pantalla: lleva el `sucursalId` de la ficha que está mirando (solo como control). */
const pedido = (cambios: Record<string, unknown>) => ({ sucursalId: ID, ...cambios });

describe("guardar el contacto", () => {
  it("misma sucursal: edita con la elegida del servidor y el nombre de la ficha leída; empresa y hora de corte del navegador se descartan", async () => {
    const r = await guardarElContactoDeLaSucursal(
      pedido({
        empresaId: "otra-empresa",
        nombre: "Nombre del navegador",
        horaDeCorte: "03:00",
        versionEsperada: 3,
        telefono: "011 5555-0000",
      }),
    );
    expect(r).toEqual({ ok: true, dato: { version: 4 } });
    expect(mundo.ediciones).toHaveLength(1);
    expect(mundo.ediciones[0]).toMatchObject({
      sucursalId: ID,
      nombre: "Casa central",
      versionEsperada: 3,
      telefono: "011 5555-0000",
    });
    expect(mundo.ediciones[0]).not.toHaveProperty("empresaId");
    expect(mundo.ediciones[0]).not.toHaveProperty("horaDeCorte");
  });

  it("con una sola abierta y ninguna elegida (la toma el servidor): la mostrada coincide y edita", async () => {
    mundo.elegida = null;
    expect(
      (await guardarElContactoDeLaSucursal(pedido({ versionEsperada: 3, web: "x.com" }))).ok,
    ).toBe(true);
    expect(mundo.ediciones.map((e) => e["sucursalId"])).toEqual([ID]);
  });

  it("otra sucursal (se cambió la elegida en otra pestaña): FISCAL_VERSION_DESACTUALIZADA y NO se llama a editar", async () => {
    mundo.elegida = OTRA;
    mundo.efectiva = OTRA;
    mundo.elegibles = [
      { id: ID, activa: true },
      { id: OTRA, activa: true },
    ];
    expect(
      await guardarElContactoDeLaSucursal(pedido({ versionEsperada: 3, correo: "a@b.com" })),
    ).toMatchObject({
      ok: false,
      error: { codigo: "FISCAL_VERSION_DESACTUALIZADA" },
    });
    expect(mundo.ediciones).toEqual([]);
  });

  it("sin sucursalId del cliente: se rechaza igual (lo más seguro: sin control no se escribe)", async () => {
    expect(await guardarElContactoDeLaSucursal({ versionEsperada: 3, web: "x.com" })).toMatchObject(
      {
        ok: false,
        error: { codigo: "FISCAL_VERSION_DESACTUALIZADA" },
      },
    );
    expect(mundo.ediciones).toEqual([]);
  });

  it("con la elegida fuera de alcance: FISCAL_SUCURSAL_FUERA_DE_ALCANCE y no se escribe", async () => {
    mundo.elegida = OTRA;
    mundo.efectiva = ID;
    expect(
      await guardarElContactoDeLaSucursal(pedido({ versionEsperada: 3, web: "x.com" })),
    ).toMatchObject({
      ok: false,
      error: { codigo: "FISCAL_SUCURSAL_FUERA_DE_ALCANCE" },
    });
    expect(mundo.ediciones).toEqual([]);
  });

  it("ausente no se toca, null y blanco viajan para borrar", async () => {
    await guardarElContactoDeLaSucursal(pedido({ versionEsperada: 3, correo: null, web: "  " }));
    const edicion = mundo.ediciones[0] ?? {};
    expect(edicion["telefono"]).toBeUndefined();
    expect(edicion["correo"]).toBeNull();
    expect(edicion["web"]).toBe("  ");
  });

  it.each([
    ["TELEFONO_DE_SUCURSAL_INVALIDO", "telefono"],
    ["CORREO_DE_SUCURSAL_INVALIDO", "correo"],
    ["WEB_DE_SUCURSAL_INVALIDA", "web"],
  ])("%s llega por el camino común con campo «%s»", async (error, campo) => {
    mundo.error = error;
    expect(
      await guardarElContactoDeLaSucursal(pedido({ versionEsperada: 3, [campo]: "x" })),
    ).toMatchObject({
      ok: false,
      error: { codigo: "FISCAL_CONFIGURACION_DATOS_INVALIDOS", campo },
    });
  });

  it("versión vieja: FISCAL_VERSION_DESACTUALIZADA", async () => {
    mundo.error = "VERSION_DESACTUALIZADA";
    expect(
      await guardarElContactoDeLaSucursal(pedido({ versionEsperada: 1, web: "x.com" })),
    ).toMatchObject({
      ok: false,
      error: { codigo: "FISCAL_VERSION_DESACTUALIZADA" },
    });
  });

  it("sin permiso: rechazo, sin éxito", async () => {
    mundo.permitido = false;
    expect(
      await guardarElContactoDeLaSucursal(pedido({ versionEsperada: 3, web: "x.com" })),
    ).toMatchObject({
      ok: false,
    });
  });

  it.each([
    ["sin pedido", undefined],
    ["un texto", "hola"],
    ["sin versión", { sucursalId: ID, web: "x.com" }],
  ])("%s: no se escribe", async (_caso, crudo) => {
    expect((await guardarElContactoDeLaSucursal(crudo)).ok).toBe(false);
    expect(mundo.ediciones).toEqual([]);
  });
});
