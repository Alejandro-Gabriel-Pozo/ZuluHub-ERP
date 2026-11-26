import { describe, expect, it, vi } from "vitest";
import { MARCA_PRINCIPAL_DE_PRUEBA } from "../../test/utilidades/marcas";
import type { ContextoOperativo } from "../contexto/contexto";
import { errorDeCodigo } from "../capacidades/experiencia/respuesta";
import { CONTROL_DE_NEGATIVO } from "../modulos/stock/publico";
import { empresaId, personaId } from "../primitivas/identificadores/marca";
import { err, ok } from "../primitivas/resultado/resultado";
import {
  abrirLaOrden,
  cargarLaNuevaOrden,
  type DependenciasDeNuevaOrdenWeb,
} from "./nueva-orden-web";

/**
 * Lo que agrega la composición de «Nueva orden»: qué se ofrece (receta vigente Y artículo propio, depósito de venta), que el navegador solo manda el id y la cantidad, que la unidad, el depósito y la
 * confirmación salen del servidor, la lista blanca de lo que vuelve, el genérico y lo inesperado. El caso de uso y las consultas, con permisos, base y concurrencia, se prueban con la base real en
 * `test/integracion/nueva-orden-web.test.ts`; acá son falsos.
 */
const contexto: ContextoOperativo = {
  tipo: "OPERATIVO",
  empresaId: empresaId("e-1"),
  personaId: personaId("p-1"),
  marcaDeEntrada: MARCA_PRINCIPAL_DE_PRUEBA,
  ahora: new Date("2026-11-26T12:00:00.000Z"),
};
const SUCURSAL = "22222222-2222-4222-8222-222222222222";
const CLAVE = "11111111-1111-4111-8111-111111111111";
const MASA = "33333333-3333-4333-8333-333333333333";
const PAN = "44444444-4444-4444-8444-444444444444";
const HARINA = "55555555-5555-4555-8555-555555555555";
const VENTA = "66666666-6666-4666-8666-666666666666";
const OTRO = "77777777-7777-4777-8777-777777777777";
const GENERICO = { ok: false, error: { codigo: "PRODUCCION_ACCION_NO_PERMITIDA" } };

const deposito = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  sucursalId: SUCURSAL,
  nombre: "Depósito",
  uso: "NORMAL",
  deVenta: true,
  activo: true,
  version: 1,
  ...extra,
});
const receta = (productoId: string, nombre: string) => ({
  productoId,
  nombre,
  claseDeUso: "ELABORADO",
  activo: true,
  version: 1,
});

function armar(
  extra: Readonly<{
    depositos?: readonly unknown[];
    articulos?: readonly unknown[];
    paginas?: readonly unknown[];
    abrir?: ReturnType<typeof vi.fn>;
  }> = {},
) {
  const registrados: string[] = [];
  const paginas = [...(extra.paginas ?? [{ recetas: [receta(MASA, "Masa")], siguiente: null }])];
  const listarRecetas = vi.fn(() =>
    Promise.resolve(ok(paginas.shift() ?? { recetas: [], siguiente: null })),
  );
  const listarDepositos = vi.fn(() => Promise.resolve(ok(extra.depositos ?? [deposito(VENTA)])));
  const articulosControlados = vi.fn(() =>
    Promise.resolve(
      ok(
        extra.articulos ?? [
          { articuloId: "a-1", productoId: MASA, nombre: "Masa", unidadId: "KILOGRAMO" },
        ],
      ),
    ),
  );
  const abrirOrden =
    extra.abrir ??
    vi.fn(() =>
      Promise.resolve(
        ok({
          ordenId: "orden-1",
          numero: 7,
          esperados: [],
          faltantes: [],
          yaExistia: false,
          secreto: "x",
        }),
      ),
    );
  const d = {
    casosDeUso: () => ({ abrirOrden }),
    consultas: () => ({ listarRecetas, listarDepositos, articulosControlados }),
    respuesta: { registrar: (detalle: string) => registrados.push(detalle) },
  } as unknown as DependenciasDeNuevaOrdenWeb;
  return { d, registrados, listarRecetas, listarDepositos, abrirOrden };
}

const pedido = (extra: Record<string, unknown> = {}) => ({
  clave: CLAVE,
  productoId: MASA,
  cantidad: "16",
  ...extra,
});

describe("lo que se ofrece al abrir una orden", () => {
  it("son los productos con receta vigente que además tienen artículo propio, con la unidad del artículo; y el depósito de venta", async () => {
    const { d, listarRecetas, listarDepositos } = armar({
      paginas: [{ recetas: [receta(MASA, "Masa"), receta(PAN, "Pan")], siguiente: null }],
    });
    expect(await cargarLaNuevaOrden(d, contexto, SUCURSAL)).toEqual({
      ok: true,
      dato: { productos: [{ id: MASA, nombre: "Masa", unidadId: "KILOGRAMO" }], depositoId: VENTA },
    });
    expect(listarDepositos).toHaveBeenCalledWith(contexto, { sucursalId: SUCURSAL });
    expect(listarRecetas).toHaveBeenCalledWith(contexto, {
      conReceta: true,
      activo: true,
      despuesDe: undefined,
    });
  });

  it("no ofrece un artículo que no tiene receta (solo cuenta lo que la lista de recetas trae)", async () => {
    const { d } = armar({
      articulos: [
        { articuloId: "a-1", productoId: MASA, nombre: "Masa", unidadId: "KILOGRAMO" },
        { articuloId: "a-2", productoId: HARINA, nombre: "Harina", unidadId: "KILOGRAMO" },
      ],
    });
    const r = await cargarLaNuevaOrden(d, contexto, SUCURSAL);
    expect(r.ok && r.dato.productos.map((p) => p.id)).toEqual([MASA]);
  });

  it("recorre las páginas de recetas hasta que no hay más, pasando la clave de la siguiente", async () => {
    const clave = { nombreClave: "masa", id: MASA };
    const { d, listarRecetas } = armar({
      articulos: [
        { articuloId: "a-1", productoId: MASA, nombre: "Masa", unidadId: "KILOGRAMO" },
        { articuloId: "a-2", productoId: PAN, nombre: "Pan", unidadId: "UNIDAD" },
      ],
      paginas: [
        { recetas: [receta(MASA, "Masa")], siguiente: clave },
        { recetas: [receta(PAN, "Pan")], siguiente: null },
      ],
    });
    const r = await cargarLaNuevaOrden(d, contexto, SUCURSAL);
    expect(r.ok && r.dato.productos.map((p) => p.id)).toEqual([MASA, PAN]);
    expect(listarRecetas).toHaveBeenCalledTimes(2);
    expect(listarRecetas).toHaveBeenLastCalledWith(contexto, {
      conReceta: true,
      activo: true,
      despuesDe: clave,
    });
  });

  it("corta en 20 páginas aunque haya más: no se ofrece lo que no se leyó", async () => {
    const clave = { nombreClave: "x", id: MASA };
    const paginas = Array.from({ length: 30 }, () => ({ recetas: [], siguiente: clave }));
    const { d, listarRecetas } = armar({ paginas });
    expect(await cargarLaNuevaOrden(d, contexto, SUCURSAL)).toMatchObject({
      ok: true,
      dato: { productos: [] },
    });
    expect(listarRecetas).toHaveBeenCalledTimes(20);
  });

  it.each([
    ["sin depósito de venta", [deposito(VENTA, { deVenta: false })]],
    ["con el de venta apagado", [deposito(VENTA, { activo: false })]],
    ["con el de venta en cuarentena", [deposito(VENTA, { uso: "CUARENTENA" })]],
    ["sin depósitos", []],
  ])("%s: el genérico, sin leer nada más", async (_nombre, depositos) => {
    const { d, listarRecetas } = armar({ depositos });
    expect(await cargarLaNuevaOrden(d, contexto, SUCURSAL)).toMatchObject(GENERICO);
    expect(listarRecetas).not.toHaveBeenCalled();
  });

  it("toma el depósito de venta aunque haya otros antes", async () => {
    const { d } = armar({
      depositos: [deposito(OTRO, { deVenta: false }), deposito(VENTA)],
    });
    const r = await cargarLaNuevaOrden(d, contexto, SUCURSAL);
    expect(r.ok && r.dato.depositoId).toBe(VENTA);
  });

  it.each(["listarDepositos", "articulosControlados", "listarRecetas"] as const)(
    "un rechazo de %s (el guard) sale con su motivo, sin leer de más y sin contarlo como inesperado",
    async (consulta) => {
      const { d, registrados } = armar();
      const rechazado = {
        ...d,
        consultas: () => ({
          ...d.consultas(),
          [consulta]: () => Promise.resolve(err("MODULO_EN_DESARROLLO")),
        }),
      } as unknown as DependenciasDeNuevaOrdenWeb;
      expect(await cargarLaNuevaOrden(rechazado, contexto, SUCURSAL)).toEqual({
        ok: false,
        error: errorDeCodigo("MODULO_EN_DESARROLLO"),
      });
      expect(registrados).toEqual([]);
    },
  );

  it("una excepción sale sin detalle y con referencia", async () => {
    const { d } = armar();
    const roto = {
      ...d,
      consultas: () => {
        throw new Error("secreto interno");
      },
    } as unknown as DependenciasDeNuevaOrdenWeb;
    const r = await cargarLaNuevaOrden(roto, contexto, SUCURSAL);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("secreto interno");
  });
});

describe("abrir la orden", () => {
  it("manda al caso de uso lo que decide el servidor (unidad, depósito de venta como origen y destino) y devuelve solo lo que la pantalla necesita", async () => {
    const { d, abrirOrden } = armar();
    const r = await abrirLaOrden(d, contexto, SUCURSAL, pedido());
    expect(r).toEqual({ ok: true, dato: { ordenId: "orden-1", numero: 7, yaExistia: false } });
    expect(abrirOrden).toHaveBeenCalledTimes(1);
    expect(abrirOrden).toHaveBeenCalledWith(contexto, {
      id: CLAVE,
      productoId: MASA,
      cantidad: "16",
      unidadId: "KILOGRAMO",
      depositoId: VENTA,
      depositoDestinoId: VENTA,
    });
  });

  it("la confirmación («Producir igual») viaja solo si se pidió, y es la del control de existencia negativa", async () => {
    const sin = armar();
    await abrirLaOrden(sin.d, contexto, SUCURSAL, pedido({ confirmar: "" }));
    expect(sin.abrirOrden.mock.calls[0]?.[1]).not.toHaveProperty("confirmaciones");
    const con = armar();
    await abrirLaOrden(con.d, contexto, SUCURSAL, pedido({ confirmar: "1" }));
    expect(con.abrirOrden.mock.calls[0]?.[1]).toMatchObject({
      confirmaciones: [CONTROL_DE_NEGATIVO],
    });
  });

  it("lo que manda el navegador (unidad, depósito, sucursal, empresa) no se usa", async () => {
    const { d, abrirOrden } = armar();
    await abrirLaOrden(
      d,
      contexto,
      SUCURSAL,
      pedido({ unidadId: "GRAMO", depositoId: OTRO, sucursalId: OTRO, empresaId: OTRO }),
    );
    expect(abrirOrden.mock.calls[0]?.[1]).toMatchObject({
      unidadId: "KILOGRAMO",
      depositoId: VENTA,
      depositoDestinoId: VENTA,
    });
    expect(JSON.stringify(abrirOrden.mock.calls[0])).not.toContain(OTRO);
  });

  it("un producto que no se ofrece sale como el genérico y no llega al caso de uso", async () => {
    const { d, abrirOrden } = armar();
    expect(await abrirLaOrden(d, contexto, SUCURSAL, pedido({ productoId: PAN }))).toMatchObject(
      GENERICO,
    );
    expect(abrirOrden).not.toHaveBeenCalled();
  });

  it.each([
    {},
    null,
    "x",
    pedido({ clave: "no" }),
    pedido({ productoId: "no" }),
    pedido({ cantidad: 16 }),
    pedido({ confirmar: "si" }),
  ])("%j no tiene la forma pedida: el genérico, sin leer ni escribir", async (crudo) => {
    const { d, abrirOrden, listarDepositos } = armar();
    expect(await abrirLaOrden(d, contexto, SUCURSAL, crudo)).toMatchObject(GENERICO);
    expect(abrirOrden).not.toHaveBeenCalled();
    expect(listarDepositos).not.toHaveBeenCalled();
  });

  it("sin depósito de venta, el genérico", async () => {
    const { d, abrirOrden } = armar({ depositos: [] });
    expect(await abrirLaOrden(d, contexto, SUCURSAL, pedido())).toMatchObject(GENERICO);
    expect(abrirOrden).not.toHaveBeenCalled();
  });

  it("el aviso «va a quedar en negativo» sale como el código de aviso (sin el detalle); cualquier otro error de la orden, como el genérico", async () => {
    const aviso = armar({
      abrir: vi.fn(() =>
        Promise.resolve(
          err({
            error: "CONTROL_REQUIERE_CONFIRMACION",
            control: CONTROL_DE_NEGATIVO,
            detalle: [{ productoId: "secreto" }],
          }),
        ),
      ),
    });
    const r = await abrirLaOrden(aviso.d, contexto, SUCURSAL, pedido());
    expect(r).toMatchObject({ ok: false, error: { codigo: "STOCK_CONTROL_AVISA" } });
    expect(JSON.stringify(r)).not.toContain("secreto");
    for (const error of ["ID_REUTILIZADO", "PRODUCTO_SIN_RECETA", { error: "CONTROL_BLOQUEA" }]) {
      const otro = armar({ abrir: vi.fn(() => Promise.resolve(err(error))) });
      expect(await abrirLaOrden(otro.d, contexto, SUCURSAL, pedido())).toMatchObject(GENERICO);
    }
  });

  it("una orden repetida devuelve `yaExistia`; una excepción del caso de uso sale sin detalle y con referencia", async () => {
    const repetida = armar({
      abrir: vi.fn(() =>
        Promise.resolve(
          ok({ ordenId: "orden-1", numero: 7, esperados: [], faltantes: [], yaExistia: true }),
        ),
      ),
    });
    expect(await abrirLaOrden(repetida.d, contexto, SUCURSAL, pedido())).toEqual({
      ok: true,
      dato: { ordenId: "orden-1", numero: 7, yaExistia: true },
    });
    const rota = armar({
      abrir: vi.fn(() => Promise.reject(new Error("la base dijo secreto-interno"))),
    });
    const r = await abrirLaOrden(rota.d, contexto, SUCURSAL, pedido());
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("secreto-interno");
    expect(rota.registrados.join(" ")).toContain("secreto-interno");
  });
});
