import { describe, expect, it } from "vitest";
import type { ContextoOperativo } from "../contexto/contexto";
import { err, ok } from "../primitivas/resultado/resultado";
import {
  fijarElControlDeStock,
  verElControlDeStock,
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
