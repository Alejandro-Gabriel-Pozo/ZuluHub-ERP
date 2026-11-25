import { describe, expect, it, vi } from "vitest";
import { MAXIMO_DE_PERSONAS_POR_CONSULTA } from "../modulos/identidad/publico";
import { err, ok } from "../primitivas/resultado/resultado";
import { codificarLaPagina } from "./entradas-de-productos";
import {
  guardarLaReceta,
  listarLasRecetas,
  listarLasVersionesDeLaReceta,
  ofrecerLosIngredientes,
  ofrecerTodosLosIngredientes,
  ofrecerTodosLosProductosSinReceta,
  verLaConfirmacionDeLaReceta,
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

function dependencias(
  consultas: Record<string, unknown> = {},
  personas: unknown = undefined,
  casosDeUso: Record<string, unknown> = {},
) {
  const registrados: string[] = [];
  const d = {
    casosDeUso: () => casosDeUso,
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

const OTRO = "1c0a7b2f-3d4e-4f60-9b8c-0d1e2f3a4b5c";
const PEDIDO = {
  productoId: ID,
  versionEsperada: 2,
  rinde: "10",
  pasos: "Hornear.",
  lineas: [{ ingredienteId: OTRO, bruto: "2.5", merma: "10" }],
  unidades: { [OTRO]: "KILOGRAMO" },
};
const ENTRADA = {
  productoId: ID,
  versionEsperada: 2,
  rinde: "10",
  pasos: "Hornear.",
  componentes: [{ productoId: OTRO, cantidad: "2.5", unidadId: "KILOGRAMO", perdida: "10" }],
};
const GENERICO = { ok: false, error: { codigo: "RECETA_ACCION_NO_PERMITIDA" } };

describe("guardarLaReceta", () => {
  it("guarda con la entrada armada por el servidor y devuelve el producto, la versión y si ya estaba", async () => {
    const guardarComposicion = vi
      .fn()
      .mockResolvedValueOnce(ok({ version: 3, yaExistia: false }))
      .mockResolvedValueOnce(ok({ version: 3, yaExistia: true }));
    const { d } = dependencias({}, undefined, { guardarComposicion });
    expect(await guardarLaReceta(d, contexto, PEDIDO)).toEqual({
      ok: true,
      dato: { productoId: ID, version: 3, yaExistia: false },
    });
    expect(guardarComposicion).toHaveBeenCalledWith(contexto, ENTRADA);
    expect(await guardarLaReceta(d, contexto, PEDIDO)).toEqual({
      ok: true,
      dato: { productoId: ID, version: 3, yaExistia: true },
    });
  });

  it("un pedido que no tiene la forma pedida, o con un ingrediente sin unidad, es el genérico y no guarda", async () => {
    const guardarComposicion = vi.fn();
    const { d } = dependencias({}, undefined, { guardarComposicion });
    expect(await guardarLaReceta(d, contexto, { ...PEDIDO, productoId: "x" })).toMatchObject(
      GENERICO,
    );
    expect(await guardarLaReceta(d, contexto, { ...PEDIDO, unidades: {} })).toMatchObject(GENERICO);
    expect(guardarComposicion).not.toHaveBeenCalled();
  });

  it("todo rechazo de la receta sale como el genérico; el guard pasa con su motivo", async () => {
    for (const error of [
      "COMPOSICION_DESACTUALIZADA",
      "PERDIDA_INVALIDA",
      "COMPONENTE_ES_INSUMO",
      { error: "FUNCION_NO_INCLUIDA", perilla: "composiciones_con_perdida" },
    ]) {
      const { d } = dependencias({}, undefined, {
        guardarComposicion: vi.fn().mockResolvedValue(err(error)),
      });
      expect(await guardarLaReceta(d, contexto, PEDIDO)).toMatchObject(GENERICO);
    }
    const { d } = dependencias({}, undefined, {
      guardarComposicion: vi.fn().mockResolvedValue(err("SIN_PERMISO")),
    });
    expect(await guardarLaReceta(d, contexto, PEDIDO)).toMatchObject({
      ok: false,
      error: { codigo: "SIN_PERMISO" },
    });
  });

  it("una excepción sale con referencia y sin detalle", async () => {
    const { d, registrados } = dependencias({}, undefined, {
      guardarComposicion: vi.fn().mockRejectedValue(new Error("boom password=hunter2")),
    });
    const r = await guardarLaReceta(d, contexto, PEDIDO);
    expect(r).toMatchObject({ ok: false, error: { codigo: "ERROR_INTERNO" } });
    expect(JSON.stringify(r)).not.toContain("hunter2");
    expect(registrados.some((l) => l.includes("hunter2"))).toBe(true);
  });
});

describe("verLaConfirmacionDeLaReceta", () => {
  const costos = (porUnidad: string, incompleto = false) => ({
    moneda: "ARS",
    total: "0.000000",
    porUnidad,
    incompleto,
    sinCosto: [],
  });
  const vista = (c?: unknown) => ({
    componentes: [{ productoId: OTRO, neto: "2.2500" }],
    ...(c === undefined ? {} : { costos: c }),
  });

  it("pide la vista previa con lo mismo que se guardaría y devuelve el neto de cada ingrediente", async () => {
    const vistaPreviaDeReceta = vi.fn().mockResolvedValue(ok(vista()));
    const { d } = dependencias({ vistaPreviaDeReceta });
    expect(await verLaConfirmacionDeLaReceta(d, contexto, PEDIDO)).toEqual({
      ok: true,
      dato: { netos: { [OTRO]: "2.2500" } },
    });
    expect(vistaPreviaDeReceta).toHaveBeenCalledWith(contexto, {
      productoId: ID,
      rinde: "10",
      componentes: ENTRADA.componentes,
    });
  });

  it("una receta nueva (versión 0) trae solo «ahora» y no mira la vigente", async () => {
    const recetaDeProducto = vi.fn();
    const { d } = dependencias({
      vistaPreviaDeReceta: vi.fn().mockResolvedValue(ok(vista(costos("333.333333")))),
      recetaDeProducto,
    });
    expect(
      await verLaConfirmacionDeLaReceta(d, contexto, { ...PEDIDO, versionEsperada: 0 }),
    ).toEqual({
      ok: true,
      dato: { netos: { [OTRO]: "2.2500" }, costos: { moneda: "ARS", ahora: "333.333333" } },
    });
    expect(recetaDeProducto).not.toHaveBeenCalled();
  });

  it("al editar: costo antes, ahora y la diferencia exacta, con signo", async () => {
    const con = (antes: string, ahora: string) =>
      dependencias({
        vistaPreviaDeReceta: vi.fn().mockResolvedValue(ok(vista(costos(ahora)))),
        recetaDeProducto: vi.fn().mockResolvedValue(ok({ ficha: { costos: costos(antes) } })),
      }).d;
    expect(
      await verLaConfirmacionDeLaReceta(con("100.000001", "140.500000"), contexto, PEDIDO),
    ).toMatchObject({
      dato: { costos: { antes: "100.000001", ahora: "140.500000", diferencia: "40.499999" } },
    });
    expect(
      await verLaConfirmacionDeLaReceta(con("140.5", "100.000001"), contexto, PEDIDO),
    ).toMatchObject({
      dato: { costos: { diferencia: "-40.499999" } },
    });
    expect(
      await verLaConfirmacionDeLaReceta(con("5.000000", "5.000000"), contexto, PEDIDO),
    ).toMatchObject({
      dato: { costos: { diferencia: "0.000000" } },
    });
  });

  it("pide la receta vigente del producto para el costo de antes", async () => {
    const recetaDeProducto = vi
      .fn()
      .mockResolvedValue(ok({ ficha: { costos: costos("1.000000") } }));
    const { d } = dependencias({
      vistaPreviaDeReceta: vi.fn().mockResolvedValue(ok(vista(costos("2.000000")))),
      recetaDeProducto,
    });
    await verLaConfirmacionDeLaReceta(d, contexto, PEDIDO);
    expect(recetaDeProducto).toHaveBeenCalledWith(contexto, { productoId: ID });
  });

  it("un costo mal formado no se resta a ciegas: sale con referencia y el registro dice cuál (ahora o antes)", async () => {
    const mal = "1.0000001";
    const ahoraMal = dependencias({
      vistaPreviaDeReceta: vi.fn().mockResolvedValue(ok(vista(costos(mal)))),
      recetaDeProducto: vi.fn().mockResolvedValue(ok({ ficha: { costos: costos("1.000000") } })),
    });
    expect(await verLaConfirmacionDeLaReceta(ahoraMal.d, contexto, PEDIDO)).toMatchObject({
      error: { codigo: "ERROR_INTERNO" },
    });
    expect(ahoraMal.registrados.join("|")).toContain("ahora:");
    const antesMal = dependencias({
      vistaPreviaDeReceta: vi.fn().mockResolvedValue(ok(vista(costos("1.000000")))),
      recetaDeProducto: vi.fn().mockResolvedValue(ok({ ficha: { costos: costos(mal) } })),
    });
    expect(await verLaConfirmacionDeLaReceta(antesMal.d, contexto, PEDIDO)).toMatchObject({
      error: { codigo: "ERROR_INTERNO" },
    });
    expect(antesMal.registrados.join("|")).toContain("antes:");
  });

  it("un costo que falta es null, nunca cero, y la diferencia no se inventa", async () => {
    const d1 = dependencias({
      vistaPreviaDeReceta: vi.fn().mockResolvedValue(ok(vista(costos("0.000000", true)))),
      recetaDeProducto: vi.fn().mockResolvedValue(ok({ ficha: { costos: costos("10.000000") } })),
    }).d;
    expect(await verLaConfirmacionDeLaReceta(d1, contexto, PEDIDO)).toEqual({
      ok: true,
      dato: {
        netos: { [OTRO]: "2.2500" },
        costos: { moneda: "ARS", ahora: null, antes: "10.000000", diferencia: null },
      },
    });
    const d2 = dependencias({
      vistaPreviaDeReceta: vi.fn().mockResolvedValue(ok(vista(costos("10.000000")))),
      recetaDeProducto: vi
        .fn()
        .mockResolvedValue(ok({ ficha: { costos: costos("0.000000", true) } })),
    }).d;
    expect(await verLaConfirmacionDeLaReceta(d2, contexto, PEDIDO)).toMatchObject({
      dato: { costos: { ahora: "10.000000", antes: null, diferencia: null } },
    });
  });

  it("sin costos.ver (la vista no trae costos) no hay costos ni se consulta la vigente; si la vigente no trae costos tampoco hay antes", async () => {
    const recetaDeProducto = vi.fn();
    const d1 = dependencias({
      vistaPreviaDeReceta: vi.fn().mockResolvedValue(ok(vista())),
      recetaDeProducto,
    }).d;
    expect(
      Object.hasOwn(
        ((await verLaConfirmacionDeLaReceta(d1, contexto, PEDIDO)) as { dato: object }).dato,
        "costos",
      ),
    ).toBe(false);
    expect(recetaDeProducto).not.toHaveBeenCalled();
    for (const vigente of [null, { ficha: null }, { ficha: {} }]) {
      const d2 = dependencias({
        vistaPreviaDeReceta: vi.fn().mockResolvedValue(ok(vista(costos("10.000000")))),
        recetaDeProducto: vi.fn().mockResolvedValue(ok(vigente)),
      }).d;
      expect(await verLaConfirmacionDeLaReceta(d2, contexto, PEDIDO)).toEqual({
        ok: true,
        dato: { netos: { [OTRO]: "2.2500" }, costos: { moneda: "ARS", ahora: "10.000000" } },
      });
    }
  });

  it("lo que no se puede calcular es null; un pedido mal formado es el genérico y no consulta", async () => {
    const vistaPreviaDeReceta = vi.fn().mockResolvedValue(ok(null));
    const { d } = dependencias({ vistaPreviaDeReceta });
    expect(await verLaConfirmacionDeLaReceta(d, contexto, PEDIDO)).toEqual({
      ok: true,
      dato: null,
    });
    vistaPreviaDeReceta.mockClear();
    expect(
      await verLaConfirmacionDeLaReceta(d, contexto, { ...PEDIDO, unidades: {} }),
    ).toMatchObject(GENERICO);
    expect(await verLaConfirmacionDeLaReceta(d, contexto, "x")).toMatchObject(GENERICO);
    expect(vistaPreviaDeReceta).not.toHaveBeenCalled();
  });

  it("errores: el guard pasa (de la vista o de la vigente) y una excepción sale con referencia", async () => {
    const d1 = dependencias({
      vistaPreviaDeReceta: vi.fn().mockResolvedValue(err("SIN_PERMISO")),
    }).d;
    expect(await verLaConfirmacionDeLaReceta(d1, contexto, PEDIDO)).toMatchObject({
      error: { codigo: "SIN_PERMISO" },
    });
    const d2 = dependencias({
      vistaPreviaDeReceta: vi.fn().mockResolvedValue(ok(vista(costos("1.000000")))),
      recetaDeProducto: vi.fn().mockResolvedValue(err("MODULO_NO_ACTIVO")),
    }).d;
    expect(await verLaConfirmacionDeLaReceta(d2, contexto, PEDIDO)).toMatchObject({
      error: { codigo: "MODULO_NO_ACTIVO" },
    });
    const d3 = dependencias({
      vistaPreviaDeReceta: vi.fn().mockRejectedValue(new Error("boom")),
    }).d;
    expect(await verLaConfirmacionDeLaReceta(d3, contexto, PEDIDO)).toMatchObject({
      error: { codigo: "ERROR_INTERNO" },
    });
  });
});

describe("las listas completas (ingredientes y productos sin receta)", () => {
  const ingrediente = (n: number) => ({
    productoId: `p${String(n)}`,
    nombre: `I${String(n)}`,
    claseDeUso: "REVENTA",
    unidadId: "UNIDAD",
  });
  const clave = (n: number) => codificarLaPagina({ id: ID, nombreClave: `n${String(n)}` });

  it("recorre todas las páginas, en orden, pidiendo cada una con la clave de la anterior y excluyendo el producto", async () => {
    const ingredientesParaReceta = vi
      .fn()
      .mockResolvedValueOnce(
        ok({ ingredientes: [ingrediente(1)], siguiente: { id: ID, nombreClave: "n1" } }),
      )
      .mockResolvedValueOnce(
        ok({ ingredientes: [ingrediente(2)], siguiente: { id: ID, nombreClave: "n2" } }),
      )
      .mockResolvedValueOnce(ok({ ingredientes: [ingrediente(3)], siguiente: null }));
    const { d } = dependencias({ ingredientesParaReceta });
    const r = await ofrecerTodosLosIngredientes(d, contexto, ID);
    expect(r).toEqual({ ok: true, dato: [ingrediente(1), ingrediente(2), ingrediente(3)] });
    expect(ingredientesParaReceta.mock.calls.map((c: unknown[]) => c[1])).toEqual([
      { excluirProductoId: ID },
      { excluirProductoId: ID, despuesDe: { id: ID, nombreClave: "n1" } },
      { excluirProductoId: ID, despuesDe: { id: ID, nombreClave: "n2" } },
    ]);
    expect(clave(1)).toBeTypeOf("string");
  });

  it("pasada la última página que se permite, sale el genérico y no una lista recortada", async () => {
    const siempre = vi
      .fn()
      .mockResolvedValue(
        ok({ ingredientes: [ingrediente(1)], siguiente: { id: ID, nombreClave: "n" } }),
      );
    const { d } = dependencias({ ingredientesParaReceta: siempre });
    expect(await ofrecerTodosLosIngredientes(d, contexto, ID)).toMatchObject(GENERICO);
    expect(siempre).toHaveBeenCalledTimes(20);
  });

  it("20 páginas justas, con la última sin siguiente, es una lista completa", async () => {
    const paginas = Array.from({ length: 20 }, (_, i) =>
      ok({
        ingredientes: [ingrediente(i)],
        siguiente: i === 19 ? null : { id: ID, nombreClave: `n${String(i)}` },
      }),
    );
    const ingredientesParaReceta = vi.fn();
    for (const p of paginas) ingredientesParaReceta.mockResolvedValueOnce(p);
    const { d } = dependencias({ ingredientesParaReceta });
    const r = await ofrecerTodosLosIngredientes(d, contexto, ID);
    expect(r.ok && r.dato).toHaveLength(20);
  });

  it("un error de una página corta la lista y sale tal cual", async () => {
    const { d } = dependencias({
      ingredientesParaReceta: vi.fn().mockResolvedValue(err("MODULO_NO_ACTIVO")),
    });
    expect(await ofrecerTodosLosIngredientes(d, contexto, ID)).toMatchObject({
      error: { codigo: "MODULO_NO_ACTIVO" },
    });
  });

  it("los productos sin receta: solo activos y sin receta, todas las páginas, mismo tope", async () => {
    const fila = (n: number) => ({
      productoId: `p${String(n)}`,
      nombre: `P${String(n)}`,
      claseDeUso: "VENDIBLE",
      activo: true,
      version: null,
    });
    const listarRecetas = vi
      .fn()
      .mockResolvedValueOnce(ok({ recetas: [fila(1)], siguiente: { id: ID, nombreClave: "n1" } }))
      .mockResolvedValueOnce(ok({ recetas: [fila(2)], siguiente: null }));
    const { d } = dependencias({ listarRecetas });
    expect(await ofrecerTodosLosProductosSinReceta(d, contexto)).toEqual({
      ok: true,
      dato: [fila(1), fila(2)],
    });
    expect(listarRecetas.mock.calls.map((c: unknown[]) => c[1])).toEqual([
      { conReceta: false, activo: true },
      { conReceta: false, activo: true, despuesDe: { id: ID, nombreClave: "n1" } },
    ]);
    const siempre = vi
      .fn()
      .mockResolvedValue(ok({ recetas: [fila(1)], siguiente: { id: ID, nombreClave: "n" } }));
    expect(
      await ofrecerTodosLosProductosSinReceta(dependencias({ listarRecetas: siempre }).d, contexto),
    ).toMatchObject(GENERICO);
    expect(siempre).toHaveBeenCalledTimes(20);
    const roto = vi.fn().mockResolvedValue(err("SIN_PERMISO"));
    expect(
      await ofrecerTodosLosProductosSinReceta(dependencias({ listarRecetas: roto }).d, contexto),
    ).toMatchObject({ error: { codigo: "SIN_PERMISO" } });
  });
});
