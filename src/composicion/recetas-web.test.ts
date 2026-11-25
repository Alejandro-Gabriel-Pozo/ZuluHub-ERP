import { describe, expect, it, vi } from "vitest";
import { MAXIMO_DE_PERSONAS_POR_CONSULTA } from "../modulos/identidad/publico";
import { err, ok } from "../primitivas/resultado/resultado";
import { codificarLaPagina } from "./entradas-de-productos";
import {
  listarLasRecetas,
  listarLasVersionesDeLaReceta,
  ofrecerLosIngredientes,
  verLaFichaDeCocina,
  verLaReceta,
  verLaVistaPreviaDeLaReceta,
  type DependenciasDeRecetasWeb,
} from "./recetas-web";

/**
 * Las lecturas de Recetas con consultas de mentira: que una entrada mala o un id que no es uuid ni llega a consultar, que los nombres se piden de a tantos como admite la consulta, que
 * un error del guard pasa y un defecto sale sin detalle. Con la base real se prueban en `test/integracion/recetas-web.test.ts`.
 */

const ID = "0d9b7a40-5c1e-4a52-9b6f-3f8d2a1c7e90";
const contexto = { empresaId: "e-1" } as never;
const VACIA = { texto: "", conReceta: "", activo: "", despues: "" };

function dependencias(consultas: Record<string, unknown> = {}, personas: unknown = undefined) {
  const registrados: string[] = [];
  const d = {
    consultas: () => consultas,
    personas: () => personas ?? { personasParaMostrar: vi.fn() },
    respuesta: { registrar: (detalle: string) => registrados.push(detalle) },
  } as unknown as DependenciasDeRecetasWeb;
  return { d, registrados };
}

describe("listarLasRecetas", () => {
  it("una entrada mala es una página vacía y no consulta", async () => {
    const listarRecetas = vi.fn();
    const { d } = dependencias({ listarRecetas });
    expect(await listarLasRecetas(d, contexto, { ...VACIA, conReceta: "todas" })).toEqual({
      ok: true,
      dato: { recetas: [], siguiente: null },
    });
    expect(listarRecetas).not.toHaveBeenCalled();
  });

  it("pide lo permitido y devuelve la clave de la siguiente como texto de la dirección", async () => {
    const listarRecetas = vi
      .fn()
      .mockResolvedValue(
        ok({ recetas: [{ productoId: ID }], siguiente: { nombreClave: "milanesa", id: ID } }),
      );
    const { d } = dependencias({ listarRecetas });
    const r = await listarLasRecetas(d, contexto, { ...VACIA, texto: "Mila", conReceta: "sin" });
    expect(listarRecetas).toHaveBeenCalledWith(contexto, { texto: "Mila", conReceta: false });
    expect(r).toEqual({
      ok: true,
      dato: {
        recetas: [{ productoId: ID }],
        siguiente: codificarLaPagina({ id: ID, nombreClave: "milanesa" }),
      },
    });
  });

  it("sin página siguiente: null", async () => {
    const { d } = dependencias({
      listarRecetas: vi.fn().mockResolvedValue(ok({ recetas: [], siguiente: null })),
    });
    expect(await listarLasRecetas(d, contexto, VACIA)).toEqual({
      ok: true,
      dato: { recetas: [], siguiente: null },
    });
  });

  it("el motivo del guard pasa; una excepción sale sin detalle y con referencia", async () => {
    const { d } = dependencias({ listarRecetas: vi.fn().mockResolvedValue(err("SIN_PERMISO")) });
    expect(await listarLasRecetas(d, contexto, VACIA)).toMatchObject({
      ok: false,
      error: { codigo: "SIN_PERMISO" },
    });
    const roto = dependencias({
      listarRecetas: vi.fn().mockRejectedValue(new Error("password=hunter2")),
    });
    const r = await listarLasRecetas(roto.d, contexto, VACIA);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("hunter2");
    expect(roto.registrados.join("\n")).toContain("hunter2");
  });
});

describe("verLaReceta", () => {
  it("un id que no es un uuid es null y no consulta", async () => {
    const recetaDeProducto = vi.fn();
    const { d } = dependencias({ recetaDeProducto });
    expect(await verLaReceta(d, contexto, { productoId: "no-es-un-uuid" })).toEqual({
      ok: true,
      dato: null,
    });
    expect(recetaDeProducto).not.toHaveBeenCalled();
  });

  it("pasa el pedido tal cual y devuelve lo que dice la consulta, también null", async () => {
    const recetaDeProducto = vi
      .fn()
      .mockResolvedValueOnce(ok({ ultimaVersion: 2 }))
      .mockResolvedValueOnce(ok(null));
    const { d } = dependencias({ recetaDeProducto });
    expect(await verLaReceta(d, contexto, { productoId: ID, version: 1 })).toEqual({
      ok: true,
      dato: { ultimaVersion: 2 },
    });
    expect(recetaDeProducto).toHaveBeenCalledWith(contexto, { productoId: ID, version: 1 });
    expect(await verLaReceta(d, contexto, { productoId: ID })).toEqual({ ok: true, dato: null });
  });

  it("errores: el guard pasa y una excepción sale con referencia", async () => {
    const { d } = dependencias({
      recetaDeProducto: vi.fn().mockResolvedValue(err("MODULO_NO_ACTIVO")),
    });
    expect(await verLaReceta(d, contexto, { productoId: ID })).toMatchObject({
      ok: false,
      error: { codigo: "MODULO_NO_ACTIVO" },
    });
    const roto = dependencias({ recetaDeProducto: vi.fn().mockRejectedValue(new Error("boom")) });
    expect(await verLaReceta(roto.d, contexto, { productoId: ID })).toMatchObject({
      ok: false,
      error: { codigo: "ERROR_INTERNO" },
    });
  });
});

describe("verLaFichaDeCocina", () => {
  it("un id que no es un uuid es null y no consulta", async () => {
    const fichaDeCocina = vi.fn();
    const { d } = dependencias({ fichaDeCocina });
    expect(await verLaFichaDeCocina(d, contexto, "no-es-un-uuid")).toEqual({
      ok: true,
      dato: null,
    });
    expect(fichaDeCocina).not.toHaveBeenCalled();
  });

  it("devuelve lo que dice la consulta, también null", async () => {
    const fichaDeCocina = vi
      .fn()
      .mockResolvedValueOnce(ok({ version: 3 }))
      .mockResolvedValueOnce(ok(null));
    const { d } = dependencias({ fichaDeCocina });
    expect(await verLaFichaDeCocina(d, contexto, ID)).toEqual({ ok: true, dato: { version: 3 } });
    expect(fichaDeCocina).toHaveBeenCalledWith(contexto, { productoId: ID });
    expect(await verLaFichaDeCocina(d, contexto, ID)).toEqual({ ok: true, dato: null });
  });

  it("errores: el guard pasa y una excepción sale con referencia", async () => {
    const { d } = dependencias({ fichaDeCocina: vi.fn().mockResolvedValue(err("SIN_PERMISO")) });
    expect(await verLaFichaDeCocina(d, contexto, ID)).toMatchObject({
      ok: false,
      error: { codigo: "SIN_PERMISO" },
    });
    const roto = dependencias({ fichaDeCocina: vi.fn().mockRejectedValue(new Error("boom")) });
    expect(await verLaFichaDeCocina(roto.d, contexto, ID)).toMatchObject({
      ok: false,
      error: { codigo: "ERROR_INTERNO" },
    });
  });
});

describe("ofrecerLosIngredientes", () => {
  it("una entrada mala es una página vacía y no consulta", async () => {
    const ingredientesParaReceta = vi.fn();
    const { d } = dependencias({ ingredientesParaReceta });
    expect(await ofrecerLosIngredientes(d, contexto, { texto: "a\u0000", despues: "" })).toEqual({
      ok: true,
      dato: { ingredientes: [], siguiente: null },
    });
    expect(ingredientesParaReceta).not.toHaveBeenCalled();
  });

  it("pide lo permitido y devuelve la siguiente como texto", async () => {
    const ingredientesParaReceta = vi
      .fn()
      .mockResolvedValue(
        ok({ ingredientes: [{ productoId: ID }], siguiente: { nombreClave: "harina", id: ID } }),
      );
    const { d } = dependencias({ ingredientesParaReceta });
    const r = await ofrecerLosIngredientes(d, contexto, { texto: "ha", despues: "" });
    expect(ingredientesParaReceta).toHaveBeenCalledWith(contexto, { texto: "ha" });
    expect(r).toEqual({
      ok: true,
      dato: { ingredientes: [{ productoId: ID }], siguiente: `${ID}:harina` },
    });
  });

  it("errores: el guard pasa y una excepción sale con referencia", async () => {
    const { d } = dependencias({
      ingredientesParaReceta: vi.fn().mockResolvedValue(err("SIN_PERMISO")),
    });
    expect(await ofrecerLosIngredientes(d, contexto, { texto: "", despues: "" })).toMatchObject({
      ok: false,
      error: { codigo: "SIN_PERMISO" },
    });
    const roto = dependencias({
      ingredientesParaReceta: vi.fn().mockRejectedValue(new Error("boom")),
    });
    expect(
      await ofrecerLosIngredientes(roto.d, contexto, { texto: "", despues: "" }),
    ).toMatchObject({ ok: false, error: { codigo: "ERROR_INTERNO" } });
  });
});

describe("verLaVistaPreviaDeLaReceta", () => {
  it("un id que no es un uuid es null y no consulta", async () => {
    const vistaPreviaDeReceta = vi.fn();
    const { d } = dependencias({ vistaPreviaDeReceta });
    expect(
      await verLaVistaPreviaDeLaReceta(d, contexto, {
        productoId: "x",
        rinde: "1",
        componentes: [],
      }),
    ).toEqual({ ok: true, dato: null });
    expect(vistaPreviaDeReceta).not.toHaveBeenCalled();
  });

  it("devuelve la vista, o null si no se puede calcular, y pasa los errores", async () => {
    const vistaPreviaDeReceta = vi
      .fn()
      .mockResolvedValueOnce(ok({ componentes: [] }))
      .mockResolvedValueOnce(ok(null))
      .mockResolvedValueOnce(err("SIN_PERMISO"));
    const { d } = dependencias({ vistaPreviaDeReceta });
    const entrada = { productoId: ID, rinde: "1", componentes: [] };
    expect(await verLaVistaPreviaDeLaReceta(d, contexto, entrada)).toEqual({
      ok: true,
      dato: { componentes: [] },
    });
    expect(vistaPreviaDeReceta).toHaveBeenCalledWith(contexto, entrada);
    expect(await verLaVistaPreviaDeLaReceta(d, contexto, entrada)).toEqual({
      ok: true,
      dato: null,
    });
    expect(await verLaVistaPreviaDeLaReceta(d, contexto, entrada)).toMatchObject({
      ok: false,
      error: { codigo: "SIN_PERMISO" },
    });
    const roto = dependencias({
      vistaPreviaDeReceta: vi.fn().mockRejectedValue(new Error("boom")),
    });
    expect(await verLaVistaPreviaDeLaReceta(roto.d, contexto, entrada)).toMatchObject({
      ok: false,
      error: { codigo: "ERROR_INTERNO" },
    });
  });
});

describe("listarLasVersionesDeLaReceta", () => {
  const version = (n: number, creadaPor: string, extra: object = {}) => ({
    version: n,
    rinde: "1.0000",
    pasos: null,
    creadaPor,
    creadaEn: new Date("2026-11-15T12:00:00Z"),
    ...extra,
  });
  const idDe = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;

  it("un id que no es un uuid es una lista vacía y no consulta", async () => {
    const versionesDeReceta = vi.fn();
    const { d } = dependencias({ versionesDeReceta });
    expect(await listarLasVersionesDeLaReceta(d, contexto, "x")).toEqual({ ok: true, dato: [] });
    expect(versionesDeReceta).not.toHaveBeenCalled();
  });

  it("pone el nombre y saca el id; sin permiso de costos no hay costo ni moneda; con costo, texto y moneda", async () => {
    const personasParaMostrar = vi
      .fn()
      .mockResolvedValue(ok(new Map([[idDe(1), "ana@ejemplo.test"]])));
    const versionesDeReceta = vi
      .fn()
      .mockResolvedValue(
        ok([
          version(2, idDe(1), { costoPorUnidad: null, moneda: "ARS" }),
          version(1, idDe(2), { costoPorUnidad: "12.500000", moneda: "ARS" }),
        ]),
      );
    const { d } = dependencias({ versionesDeReceta }, { personasParaMostrar });
    const r = await listarLasVersionesDeLaReceta(d, contexto, ID);
    expect(versionesDeReceta).toHaveBeenCalledWith(contexto, { productoId: ID });
    expect(personasParaMostrar).toHaveBeenCalledWith(contexto, { ids: [idDe(1), idDe(2)] });
    expect(r).toEqual({
      ok: true,
      dato: [
        {
          version: 2,
          rinde: "1.0000",
          pasos: null,
          creadaPorNombre: "ana@ejemplo.test",
          creadaEn: new Date("2026-11-15T12:00:00Z"),
          costoPorUnidad: null,
          moneda: "ARS",
        },
        {
          version: 1,
          rinde: "1.0000",
          pasos: null,
          creadaPorNombre: null,
          creadaEn: new Date("2026-11-15T12:00:00Z"),
          costoPorUnidad: "12.500000",
          moneda: "ARS",
        },
      ],
    });
    // Sin costos.ver: la versión no trae ni costo ni moneda y así sale.
    versionesDeReceta.mockResolvedValue(ok([version(1, idDe(1))]));
    const sinCostos = await listarLasVersionesDeLaReceta(d, contexto, ID);
    expect(sinCostos.ok && Object.keys(sinCostos.dato[0] ?? {}).sort()).toEqual(
      ["creadaEn", "creadaPorNombre", "pasos", "rinde", "version"].sort(),
    );
  });

  it("pide los nombres de a tantos como admite la consulta, cada persona una sola vez", async () => {
    const total = MAXIMO_DE_PERSONAS_POR_CONSULTA * 2 + 5;
    const versiones = Array.from({ length: total }, (_, i) => version(total - i, idDe(i)));
    // Una persona repetida no se pide dos veces.
    versiones.push(version(0, idDe(0)));
    const personasParaMostrar = vi.fn((_c: unknown, { ids }: { ids: readonly string[] }) =>
      Promise.resolve(ok(new Map(ids.map((id) => [id, `${id}@ejemplo.test`])))),
    );
    const { d } = dependencias(
      { versionesDeReceta: vi.fn().mockResolvedValue(ok(versiones)) },
      { personasParaMostrar },
    );
    const r = await listarLasVersionesDeLaReceta(d, contexto, ID);
    expect(personasParaMostrar.mock.calls.map(([, { ids }]) => ids.length)).toEqual([
      MAXIMO_DE_PERSONAS_POR_CONSULTA,
      MAXIMO_DE_PERSONAS_POR_CONSULTA,
      5,
    ]);
    expect(
      r.ok &&
        r.dato.every((v, i) => v.creadaPorNombre === `${idDe(i === total ? 0 : i)}@ejemplo.test`),
    ).toBe(true);
  });

  it("sin versiones no pide nombres", async () => {
    const personasParaMostrar = vi.fn();
    const { d } = dependencias(
      { versionesDeReceta: vi.fn().mockResolvedValue(ok([])) },
      { personasParaMostrar },
    );
    expect(await listarLasVersionesDeLaReceta(d, contexto, ID)).toEqual({ ok: true, dato: [] });
    expect(personasParaMostrar).not.toHaveBeenCalled();
  });

  it("errores: el de las versiones, el de los nombres y una excepción", async () => {
    const a = dependencias({
      versionesDeReceta: vi.fn().mockResolvedValue(err("MODULO_NO_ACTIVO")),
    });
    expect(await listarLasVersionesDeLaReceta(a.d, contexto, ID)).toMatchObject({
      ok: false,
      error: { codigo: "MODULO_NO_ACTIVO" },
    });
    const b = dependencias(
      { versionesDeReceta: vi.fn().mockResolvedValue(ok([version(1, idDe(1))])) },
      { personasParaMostrar: vi.fn().mockResolvedValue(err("SIN_PERMISO")) },
    );
    expect(await listarLasVersionesDeLaReceta(b.d, contexto, ID)).toMatchObject({
      ok: false,
      error: { codigo: "SIN_PERMISO" },
    });
    const c = dependencias({ versionesDeReceta: vi.fn().mockRejectedValue(new Error("boom")) });
    expect(await listarLasVersionesDeLaReceta(c.d, contexto, ID)).toMatchObject({
      ok: false,
      error: { codigo: "ERROR_INTERNO" },
    });
  });
});
