import { describe, expect, it, vi } from "vitest";
import type { ContextoOperativo } from "../contexto/contexto";
import { CONFIRMACION_DE_CUENTAS_ABIERTAS } from "../modulos/stock/publico";
import { err, ok } from "../primitivas/resultado/resultado";
import {
  fijarElControlDeStock,
  verElControlDeStock,
  verLaExistenciaPropia,
  type DependenciasDeControlDeStockWeb,
} from "./control-de-stock-web";

/**
 * El tilde «Se controla el stock» de la web con el módulo simulado: qué lee y qué pide la composición, y qué sale hacia la pantalla en cada resultado. Contra la base real,
 * `test/integracion/control-de-stock-web.test.ts`.
 */
const ID = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const contexto = { empresaId: "e1" } as unknown as ContextoOperativo;
const GENERICO = "CATALOGO_ACCION_NO_PERMITIDA";

type Montaje = {
  llamadas: { que: string; entrada: unknown }[];
  registrados: string[];
  controlar: () => unknown;
  dejar: () => unknown;
  leer: () => unknown;
};
const montar = (cambios: Partial<Montaje> = {}) => {
  const m: Montaje = {
    llamadas: [],
    registrados: [],
    controlar: () => ok({ articuloId: "a1", yaExistia: false }),
    dejar: () => ok({ yaEstaba: false }),
    leer: () => ok({ controlado: true }),
    ...cambios,
  };
  const d = {
    casosDeUso: () => ({
      controlarArticulo: (c: unknown, entrada: unknown) => {
        m.llamadas.push({ que: "controlar", entrada: { c, entrada } });
        return Promise.resolve(m.controlar());
      },
      dejarDeControlar: (c: unknown, entrada: unknown) => {
        m.llamadas.push({ que: "dejar", entrada: { c, entrada } });
        return Promise.resolve(m.dejar());
      },
    }),
    consultas: () => ({
      controlDeStockDelProducto: (c: unknown, entrada: unknown) => {
        m.llamadas.push({ que: "leer", entrada: { c, entrada } });
        return Promise.resolve(m.leer());
      },
    }),
    respuesta: { registrar: (detalle: string) => m.registrados.push(detalle) },
  } as unknown as DependenciasDeControlDeStockWeb;
  return { m, d };
};
const codigoDe = (r: { ok: boolean; error?: { codigo: string } }) =>
  r.ok ? "OK" : (r.error?.codigo ?? "?");

describe("verElControlDeStock", () => {
  it("pide la consulta con el contexto y el producto, y devuelve solo «controlado»", async () => {
    const { m, d } = montar({ leer: () => ok({ controlado: true, otro: "no sale" }) });
    expect(await verElControlDeStock(d, contexto, ID)).toEqual({
      ok: true,
      dato: { controlado: true },
    });
    expect(m.llamadas).toEqual([
      { que: "leer", entrada: { c: contexto, entrada: { productoId: ID } } },
    ]);
  });

  it("un id que no tiene forma de id sale como el genérico y no consulta", async () => {
    const { m, d } = montar();
    expect(codigoDe(await verElControlDeStock(d, contexto, "no-es-un-uuid"))).toBe(GENERICO);
    expect(m.llamadas).toEqual([]);
  });

  it("un error de negocio de la consulta sale como el genérico; el de la base, como inesperado con referencia", async () => {
    const a = montar({ leer: () => err("MODULO_EN_DESARROLLO") });
    expect(codigoDe(await verElControlDeStock(a.d, contexto, ID))).toBe(GENERICO);
    const b = montar({ leer: () => err({ tipo: "ERROR_DE_BASE" }) });
    const r = await verElControlDeStock(b.d, contexto, ID);
    expect(r.ok).toBe(false);
    expect(codigoDe(r)).not.toBe(GENERICO);
    expect(b.m.registrados).toHaveLength(1);
  });

  it("una excepción sale sin detalle y con referencia", async () => {
    const { m, d } = montar({
      leer: () => {
        throw new Error("la base no responde");
      },
    });
    const r = await verElControlDeStock(d, contexto, ID);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("la base no responde");
    expect(m.registrados).toHaveLength(1);
  });
});

describe("fijarElControlDeStock", () => {
  it("«true» llama a controlarArticulo con el producto y devuelve el estado y si ya estaba", async () => {
    const { m, d } = montar({ controlar: () => ok({ articuloId: "a1", yaExistia: true }) });
    expect(await fijarElControlDeStock(d, contexto, { productoId: ID, controlado: true })).toEqual({
      ok: true,
      dato: { productoId: ID, controlado: true, yaEstaba: true },
    });
    expect(m.llamadas).toEqual([
      { que: "controlar", entrada: { c: contexto, entrada: { productoId: ID } } },
    ]);
  });

  it("«false» llama a dejarDeControlar y devuelve el estado y si ya estaba", async () => {
    const { m, d } = montar({ dejar: () => ok({ yaEstaba: true }) });
    expect(await fijarElControlDeStock(d, contexto, { productoId: ID, controlado: false })).toEqual(
      {
        ok: true,
        dato: { productoId: ID, controlado: false, yaEstaba: true },
      },
    );
    expect(m.llamadas).toEqual([
      { que: "dejar", entrada: { c: contexto, entrada: { productoId: ID } } },
    ]);
  });

  it("la función «Producción» apagada (error con forma de objeto) y la falta de receta salen como el genérico, no como un fallo inesperado", async () => {
    for (const error of [
      { error: "FUNCION_NO_INCLUIDA", perilla: "produccion" },
      "SIN_COMPOSICION",
    ]) {
      const { d } = montar({ controlar: () => err(error) });
      expect(
        codigoDe(await fijarElControlDeStock(d, contexto, { productoId: ID, controlado: true })),
      ).toBe(GENERICO);
    }
  });

  it("solo `FUNCION_NO_INCLUIDA` con forma de objeto es el genérico: otro objeto, uno sin `error` o la ausencia de error siguen su camino común", async () => {
    for (const error of [{ error: "OTRO_ERROR" }, { tipo: "X" }, { error: undefined }, null]) {
      const { d } = montar({ controlar: () => err(error) });
      const r = await fijarElControlDeStock(d, contexto, { productoId: ID, controlado: true });
      expect(codigoDe(r)).not.toBe(GENERICO);
    }
  });

  it("confirmar las cuentas abiertas pasa la confirmación declarada al caso de uso; sin confirmar o con otro valor no la pasa", async () => {
    const a = montar();
    await fijarElControlDeStock(a.d, contexto, {
      productoId: ID,
      controlado: true,
      confirmarCuentasAbiertas: true,
    });
    expect(a.m.llamadas).toEqual([
      {
        que: "controlar",
        entrada: {
          c: contexto,
          entrada: { productoId: ID, confirmaciones: [CONFIRMACION_DE_CUENTAS_ABIERTAS] },
        },
      },
    ]);
    const b = montar();
    await fijarElControlDeStock(b.d, contexto, {
      productoId: ID,
      controlado: true,
      confirmarCuentasAbiertas: false,
    });
    expect(b.m.llamadas).toEqual([
      { que: "controlar", entrada: { c: contexto, entrada: { productoId: ID } } },
    ]);
  });

  it("«hay cuentas abiertas con el plato» sale como el aviso de confirmar, sin la cantidad ni detalle, y no se registra como un fallo", async () => {
    const { m, d } = montar({
      controlar: () => err({ error: "CUENTAS_ABIERTAS_REQUIEREN_CONFIRMACION", cuentas: 7 }),
    });
    const r = await fijarElControlDeStock(d, contexto, { productoId: ID, controlado: true });
    expect(codigoDe(r)).toBe("PRODUCCION_CUENTAS_ABIERTAS");
    expect(JSON.stringify(r)).not.toContain("7");
    expect(m.registrados).toEqual([]);
  });

  it("no altera: «true» nunca llama a dejarDeControlar ni «false» a controlarArticulo", async () => {
    const a = montar();
    await fijarElControlDeStock(a.d, contexto, { productoId: ID, controlado: true });
    expect(a.m.llamadas.map((l) => l.que)).toEqual(["controlar"]);
    const b = montar();
    await fijarElControlDeStock(b.d, contexto, { productoId: ID, controlado: false });
    expect(b.m.llamadas.map((l) => l.que)).toEqual(["dejar"]);
  });

  it.each([
    ["una clave de más", { productoId: ID, controlado: true, empresaId: "otra" }],
    ["sin controlado", { productoId: ID }],
    ["id mal formado", { productoId: "x", controlado: true }],
    ["nulo", null],
  ])("un pedido inválido (%s) sale como el genérico y no llama a nada", async (_caso, crudo) => {
    const { m, d } = montar();
    expect(codigoDe(await fijarElControlDeStock(d, contexto, crudo))).toBe(GENERICO);
    expect(m.llamadas).toEqual([]);
  });

  it.each([
    "CLASE_NO_CONTROLABLE",
    "PRODUCTO_INACTIVO",
    "ARTICULO_EN_COMPOSICION_ACTIVA",
    "SIN_PERMISO",
  ])("el error de negocio %s sale como el genérico, en los dos sentidos", async (codigo) => {
    const a = montar({ controlar: () => err(codigo) });
    expect(
      codigoDe(await fijarElControlDeStock(a.d, contexto, { productoId: ID, controlado: true })),
    ).toBe(GENERICO);
    const b = montar({ dejar: () => err(codigo) });
    expect(
      codigoDe(await fijarElControlDeStock(b.d, contexto, { productoId: ID, controlado: false })),
    ).toBe(GENERICO);
  });

  it("un defecto de la base no se disfraza de «no permitido»: sale inesperado, con referencia y registrado", async () => {
    const a = montar({ controlar: () => err("ERROR_DE_LA_BASE_NO_TRADUCIDO") });
    const r = await fijarElControlDeStock(a.d, contexto, { productoId: ID, controlado: true });
    expect(r.ok).toBe(false);
    expect(codigoDe(r)).not.toBe(GENERICO);
    expect(a.m.registrados).toHaveLength(1);
    const b = montar({ dejar: () => err({ tipo: "SERIALIZACION_AGOTADA" }) });
    const s = await fijarElControlDeStock(b.d, contexto, { productoId: ID, controlado: false });
    expect(s.ok).toBe(false);
    expect(codigoDe(s)).not.toBe(GENERICO);
    expect(b.m.registrados).toHaveLength(1);
  });

  it("una excepción sale sin detalle y con referencia, en los dos sentidos", async () => {
    const boom = () => {
      throw new Error("se cayó");
    };
    for (const [controlado, cambios] of [
      [true, { controlar: boom }],
      [false, { dejar: boom }],
    ] as const) {
      const { m, d } = montar(cambios);
      const r = await fijarElControlDeStock(d, contexto, { productoId: ID, controlado });
      expect(r.ok).toBe(false);
      expect(JSON.stringify(r)).not.toContain("se cayó");
      expect(m.registrados).toHaveLength(1);
    }
  });
});

describe("verLaExistenciaPropia", () => {
  const entrada = { productoId: ID, nombre: "Medialuna", unidadId: "UNIDAD" };
  const fila = (productoId: string, existencia: string, unidadId = "UNIDAD") => ({
    productoId,
    existencia,
    unidadId,
  });
  const con = (existencias: unknown) =>
    ({
      casosDeUso: () => ({}),
      consultas: () => ({ existencias }),
      respuesta: { registrar: () => undefined },
    }) as unknown as DependenciasDeControlDeStockWeb;

  it("una existencia que no es un decimal exacto no se suma: sale como inesperado y deja registrado de qué dato era", async () => {
    const registrados: string[] = [];
    const d = {
      casosDeUso: () => ({}),
      consultas: () => ({
        existencias: () => Promise.resolve(ok({ existencias: [fila(ID, "1,5")], siguiente: null })),
      }),
      respuesta: { registrar: (detalle: string) => registrados.push(detalle) },
    } as unknown as DependenciasDeControlDeStockWeb;
    const r = await verLaExistenciaPropia(d, contexto, entrada);
    expect(r.ok).toBe(false);
    expect(registrados).toHaveLength(1);
    expect(registrados[0]).toContain("existencia");
  });

  it("suma exacta de los saldos del producto en los depósitos que ve la persona y solo de ese producto (otro con nombre parecido no cuenta)", async () => {
    const llamadas: unknown[] = [];
    const d = con((c: unknown, e: unknown) => {
      llamadas.push([c, e]);
      return Promise.resolve(
        ok({
          existencias: [
            fila(ID, "12.5000"),
            fila("otro", "100.0000"),
            fila(ID, "0.1250"),
            fila(ID, "-2.0000"),
          ],
          siguiente: null,
        }),
      );
    });
    expect(await verLaExistenciaPropia(d, contexto, entrada)).toEqual({
      ok: true,
      dato: { existencia: "10.6250", unidadId: "UNIDAD" },
    });
    expect(llamadas).toEqual([[contexto, { texto: "Medialuna", despuesDe: undefined }]]);
  });

  it("sin filas (nunca se movió) es cero de verdad, en la unidad del producto", async () => {
    const d = con(() => Promise.resolve(ok({ existencias: [], siguiente: null })));
    expect(await verLaExistenciaPropia(d, contexto, entrada)).toEqual({
      ok: true,
      dato: { existencia: "0.0000", unidadId: "UNIDAD" },
    });
  });

  it("recorre las páginas con el cursor de la anterior y suma todas", async () => {
    const cursor = { nombreClave: "medialuna", articuloId: "a", depositoId: "d" };
    const pedidos: unknown[] = [];
    const paginas = [
      ok({ existencias: [fila(ID, "1.0000", "KILOGRAMO")], siguiente: cursor }),
      ok({ existencias: [fila(ID, "2.0000", "KILOGRAMO")], siguiente: null }),
    ];
    const d = con((_: unknown, e: unknown) => {
      pedidos.push(e);
      return Promise.resolve(paginas.shift());
    });
    expect(await verLaExistenciaPropia(d, contexto, entrada)).toEqual({
      ok: true,
      dato: { existencia: "3.0000", unidadId: "KILOGRAMO" },
    });
    expect(pedidos).toEqual([
      { texto: "Medialuna", despuesDe: undefined },
      { texto: "Medialuna", despuesDe: cursor },
    ]);
  });

  it("falla cerrado: demasiadas páginas, o un nombre que no sirve de búsqueda, es «no se sabe» (null), nunca un cero", async () => {
    const siempre = vi
      .fn()
      .mockResolvedValue(
        ok({ existencias: [], siguiente: { nombreClave: "m", articuloId: "a", depositoId: "d" } }),
      );
    expect(await verLaExistenciaPropia(con(siempre), contexto, entrada)).toEqual({
      ok: true,
      dato: null,
    });
    expect(siempre).toHaveBeenCalledTimes(5);
    const noPide = vi.fn();
    for (const nombre of ["", "   ", "a\u0000b"]) {
      expect(await verLaExistenciaPropia(con(noPide), contexto, { ...entrada, nombre })).toEqual({
        ok: true,
        dato: null,
      });
    }
    expect(noPide).not.toHaveBeenCalled();
  });

  it("un id que no es uuid es el genérico y no consulta; un error de negocio sale como el genérico y una excepción con referencia", async () => {
    const consulta = vi.fn();
    expect(
      await verLaExistenciaPropia(con(consulta), contexto, { ...entrada, productoId: "x" }),
    ).toMatchObject({
      ok: false,
      error: { codigo: GENERICO },
    });
    expect(consulta).not.toHaveBeenCalled();
    const sinPermiso = con(() => Promise.resolve(err("SIN_PERMISO")));
    // Un error de negocio del módulo (aquí, sin permiso) sale como el genérico: no dice cuál.
    expect(await verLaExistenciaPropia(sinPermiso, contexto, entrada)).toMatchObject({
      ok: false,
      error: { codigo: GENERICO },
    });
    const roto = con(() => Promise.reject(new Error("boom")));
    expect(await verLaExistenciaPropia(roto, contexto, entrada)).toMatchObject({
      ok: false,
      error: { codigo: "ERROR_INTERNO" },
    });
  });
});
