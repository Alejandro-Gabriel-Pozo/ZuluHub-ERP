import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  montarCatalogo,
  nombreAlAzarDeProducto,
  nuevoId,
  valorDe,
  type EscenarioDeCatalogo,
} from "./catalogo-apoyo";

/**
 * A7: la venta por fracciones (porciones 2, 4 y 8) y por peso. Con la perilla `venta_por_fracciones_y_peso` APAGADA (de base) solo se carga la forma del piloto;
 * encendida, se ofrecen fracciones (el paso mínimo se DERIVA de la más fina) o se vende por peso (otra unidad de masa, paso a mano). La base impone las siete listas
 * posibles, el paso derivado y que las fracciones sean de un producto «por unidad» aunque el código se olvide.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

describe.skipIf(base === null)("catálogo: fracciones y peso (A7)", () => {
  let c: Awaited<ReturnType<typeof montarCatalogo>>;
  let apagada: Awaited<ReturnType<typeof montarCatalogo>>;
  let e: EscenarioDeCatalogo;
  let a: EscenarioDeCatalogo;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarCatalogo(base, { fraccionesYPeso: true });
    apagada = await montarCatalogo(base, { conexiones: 4 });
    e = await c.escenario();
    a = await apagada.escenario();
  });
  afterAll(async () => {
    if (base === null) return;
    await c.cerrar();
    await apagada.cerrar();
  });

  const crear = async (extra: Record<string, unknown> = {}) =>
    valorDe(
      await c.casos.crearProducto(e.gerente, {
        id: nuevoId(),
        claseDeUso: "VENDIBLE",
        nombre: nombreAlAzarDeProducto(),
        unidadBaseId: "UNIDAD",
        alicuota: "21",
        ...extra,
      }),
    ).productoId;
  const producto = async (id: string) =>
    (await c.filas("select * from producto where id = $1", [id]))[0];
  const version = async (id: string) => Number((await producto(id))?.["version"]);
  const porciones = async (id: string) => (await producto(id))?.["porciones_ofrecidas"];
  const cambiar = (productoId: string, v: number, extra: Record<string, unknown>) =>
    c.casos.cambiarFormaDeVenta(e.gerente, {
      productoId,
      versionEsperada: v,
      unidadDeVentaId: "UNIDAD",
      ...extra,
    });
  const filasDePrecio = (id: string) =>
    c.filas(
      "select unidad_id, paso_minimo::text as paso from precio_de_venta where producto_id = $1 order by vigente_desde, id",
      [id],
    );

  it("con la perilla apagada (de base) las fracciones y el peso no se cargan, y el piloto sigue igual; no se escribe nada", async () => {
    const id = valorDe(
      await apagada.casos.crearProducto(a.gerente, {
        id: nuevoId(),
        claseDeUso: "VENDIBLE",
        nombre: nombreAlAzarDeProducto(),
        unidadBaseId: "GRAMO",
        alicuota: "21",
      }),
    ).productoId;
    const v = Number(
      (await apagada.filas("select version from producto where id = $1", [id]))[0]?.["version"],
    );
    const pedir = (extra: Record<string, unknown>) =>
      apagada.casos.cambiarFormaDeVenta(a.gerente, {
        productoId: id,
        versionEsperada: v,
        unidadDeVentaId: "KILOGRAMO",
        ...extra,
      });
    expect(await pedir({ pasoMinimo: "0.001" })).toEqual({
      ok: false,
      error: "FORMA_DE_VENTA_NO_SOPORTADA",
    });
    // Las fracciones tampoco, aunque la forma pedida sea válida (y aunque sea otro producto «por unidad»).
    const unidad = valorDe(
      await apagada.casos.crearProducto(a.gerente, {
        id: nuevoId(),
        claseDeUso: "VENDIBLE",
        nombre: nombreAlAzarDeProducto(),
        unidadBaseId: "UNIDAD",
        alicuota: "21",
      }),
    ).productoId;
    expect(
      await apagada.casos.cambiarFormaDeVenta(a.gerente, {
        productoId: unidad,
        versionEsperada: 1,
        unidadDeVentaId: "UNIDAD",
        porciones: [2, 8],
      }),
    ).toEqual({ ok: false, error: "FORMA_DE_VENTA_NO_SOPORTADA" });
    expect(
      (
        await apagada.filas("select version, porciones_ofrecidas from producto where id = $1", [
          unidad,
        ])
      )[0],
    ).toEqual({ version: 1, porciones_ofrecidas: [] });
    // Crear con otra forma en el alta tampoco (la misma regla).
    expect(
      await apagada.casos.crearProducto(a.gerente, {
        id: nuevoId(),
        claseDeUso: "VENDIBLE",
        nombre: nombreAlAzarDeProducto(),
        unidadBaseId: "GRAMO",
        unidadDeVentaId: "KILOGRAMO",
        pasoMinimo: "0.5",
        alicuota: "21",
      }),
    ).toEqual({ ok: false, error: "FORMA_DE_VENTA_NO_SOPORTADA" });
  });

  it("con la perilla encendida: porciones 2 y 8 → el paso mínimo se deriva (0,125), se guardan las porciones, los precios se vuelven a cargar con el paso nuevo y queda auditado", async () => {
    const id = await crear();
    valorDe(
      await c.casos.cambiarPrecio(e.gerente, {
        precioId: nuevoId(),
        productoId: id,
        opcionId: null,
        sucursalId: null,
        precioIdEsperado: null,
        precio: "12000",
      }),
    );
    const r = valorDe(await cambiar(id, await version(id), { porciones: [8, 2] }));
    expect(r.resultado).toBe("SOLO_PASO");
    expect(r.yaEstaba).toBe(false);
    const fila = await producto(id);
    expect(fila).toMatchObject({ porciones_ofrecidas: [2, 8], unidad_de_venta_id: "UNIDAD" });
    expect(Number(fila?.["paso_minimo"])).toBe(0.125);
    expect((await filasDePrecio(id)).map((f) => f["paso"])).toEqual(["1.0000", "0.1250"]);
    const auditoria = await c.auditoria(e.empresa, "PRODUCTO_FORMA_DE_VENTA_CAMBIADA");
    expect(auditoria.at(-1)).toMatchObject({
      antes: { porciones: [], pasoMinimo: "1.0000" },
      despues: { porciones: [2, 8], pasoMinimo: "0.1250" },
    });
  });

  it("repetir lo mismo, aunque las porciones lleguen en otro orden, es SIN_CAMBIOS: no escribe ni sube la versión", async () => {
    const id = await crear();
    valorDe(await cambiar(id, await version(id), { porciones: [2, 4] }));
    const v = await version(id);
    const filas = (await filasDePrecio(id)).length;
    const otra = valorDe(await cambiar(id, v, { porciones: [4, 2] }));
    expect(otra).toMatchObject({ resultado: "SIN_CAMBIOS", yaEstaba: true, version: v });
    expect(await version(id)).toBe(v);
    expect((await filasDePrecio(id)).length).toBe(filas);
  });

  it("cambiar solo las porciones sin cambiar el paso (2 y 8 → solo 8) no toca los precios y sí la versión; sacar las fracciones vuelve al paso 1", async () => {
    const id = await crear();
    valorDe(
      await c.casos.cambiarPrecio(e.gerente, {
        precioId: nuevoId(),
        productoId: id,
        opcionId: null,
        sucursalId: null,
        precioIdEsperado: null,
        precio: "5000",
      }),
    );
    valorDe(await cambiar(id, await version(id), { porciones: [2, 8] }));
    const filas = (await filasDePrecio(id)).length;
    const v = await version(id);
    const r = valorDe(await cambiar(id, v, { porciones: [8] }));
    expect(r).toMatchObject({ resultado: "SOLO_PASO", preciosConvertidos: 0, yaEstaba: false });
    expect(await porciones(id)).toEqual([8]);
    expect(await version(id)).toBe(v + 1);
    expect((await filasDePrecio(id)).length).toBe(filas);
    // Volver al piloto: sin porciones y paso 1; las porciones se vacían (la base lo exige).
    valorDe(await cambiar(id, await version(id), { pasoMinimo: "1" }));
    expect(await porciones(id)).toEqual([]);
    expect(Number((await producto(id))?.["paso_minimo"])).toBe(1);
  });

  it("venta por peso: unidad de masa con el paso a mano (kg, 0,001) y las porciones quedan vacías", async () => {
    const id = await crear({ unidadBaseId: "GRAMO" });
    const r = valorDe(
      await c.casos.cambiarFormaDeVenta(e.gerente, {
        productoId: id,
        versionEsperada: await version(id),
        unidadDeVentaId: "KILOGRAMO",
        pasoMinimo: "0.001",
      }),
    );
    expect(r.resultado).toBe("CONVERTIDO");
    expect(await porciones(id)).toEqual([]);
    expect(Number((await producto(id))?.["paso_minimo"])).toBe(0.001);
  });

  it("errores de forma: paso y porciones a la vez, ninguno, porciones inválidas, repetidas o vacías, y fracciones en un producto de peso", async () => {
    const id = await crear();
    const v = await version(id);
    const malas: Record<string, unknown>[] = [
      { porciones: [2], pasoMinimo: "0.5" },
      {},
      { porciones: [] },
      { porciones: [3] },
      { porciones: [6, 2] },
      { porciones: [2, 2] },
      { porciones: [16] },
    ];
    for (const extra of malas) {
      expect(await cambiar(id, v, extra), JSON.stringify(extra)).toEqual({
        ok: false,
        error: "FORMA_DE_VENTA_INVALIDA",
      });
    }
    const peso = await crear({ unidadBaseId: "GRAMO" });
    expect(
      await c.casos.cambiarFormaDeVenta(e.gerente, {
        productoId: peso,
        versionEsperada: await version(peso),
        unidadDeVentaId: "GRAMO",
        porciones: [2],
      }),
    ).toEqual({ ok: false, error: "FORMA_DE_VENTA_INVALIDA" });
    expect(await porciones(id)).toEqual([]);
    expect(await version(id)).toBe(v);
  });

  it("una versión vieja no pisa: VERSION_DESACTUALIZADA, sin escribir", async () => {
    const id = await crear();
    const v = await version(id);
    valorDe(await cambiar(id, v, { porciones: [4] }));
    expect(await cambiar(id, v, { porciones: [8] })).toEqual({
      ok: false,
      error: "VERSION_DESACTUALIZADA",
    });
    expect(await porciones(id)).toEqual([4]);
  });

  it("dos pedidos distintos a la vez sobre la misma versión: uno gana y el otro ve VERSION_DESACTUALIZADA; el producto queda en una forma coherente", async () => {
    const id = await crear();
    const v = await version(id);
    const [x, y] = await Promise.all([
      cambiar(id, v, { porciones: [2] }),
      cambiar(id, v, { porciones: [8] }),
    ]);
    const resultados = [x, y];
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(resultados.find((r) => !r.ok)).toEqual({ ok: false, error: "VERSION_DESACTUALIZADA" });
    const fila = await producto(id);
    const ofrecidas = fila?.["porciones_ofrecidas"] as number[];
    expect(Number(fila?.["paso_minimo"])).toBe(1 / (ofrecidas[0] as number));
  });

  it("la base impone las listas posibles, el paso derivado y la unidad aunque el código se olvide (SQL del dueño)", async () => {
    const id = await crear();
    const fallo = async (sql: string, p: unknown[] = []) => {
      try {
        await c.dueno.query(sql, p);
      } catch (error) {
        return (error as { constraint?: string }).constraint;
      }
      return "NO FALLÓ";
    };
    // Tercios y sextos, listas desordenadas o repetidas: no.
    for (const lista of ["{3}", "{6}", "{4,2}", "{2,2}", "{2,4,8,16}"]) {
      expect(
        await fallo(
          "update producto set porciones_ofrecidas = $2::smallint[], paso_minimo = 0.125 where id = $1",
          [id, lista],
        ),
        lista,
      ).toBe("producto_porciones_ck");
    }
    // El paso tiene que ser 1 / la más fina.
    expect(
      await fallo(
        "update producto set porciones_ofrecidas = '{2,8}', paso_minimo = 0.25 where id = $1",
        [id],
      ),
    ).toBe("producto_porciones_ck");
    expect(
      await fallo(
        "update producto set porciones_ofrecidas = '{4}', paso_minimo = 1 where id = $1",
        [id],
      ),
    ).toBe("producto_porciones_ck");
    // Fracciones solo de un producto «por unidad».
    const pesado = await crear({ unidadBaseId: "GRAMO" });
    expect(
      await fallo(
        "update producto set porciones_ofrecidas = '{2}', paso_minimo = 0.5 where id = $1",
        [pesado],
      ),
    ).toBe("producto_porciones_ck");
    // Lo válido sí entra y el paso derivado es exacto.
    expect(
      await fallo(
        "update producto set porciones_ofrecidas = '{2,4,8}', paso_minimo = 0.125 where id = $1",
        [id],
      ),
    ).toBe("NO FALLÓ");
    expect(await porciones(id)).toEqual([2, 4, 8]);
  });

  it("el rol de la aplicación solo escribe las porciones por la forma de venta: no puede escribirlas en el alta ni en otras tablas", async () => {
    const { rows } = await c.dueno.query<{ puede: boolean }>(
      "select has_column_privilege('pedernal_app', 'public.producto', 'porciones_ofrecidas', 'UPDATE') as puede",
    );
    expect(rows[0]?.puede).toBe(true);
    const insert = await c.dueno.query<{ puede: boolean }>(
      "select has_column_privilege('pedernal_app', 'public.producto', 'porciones_ofrecidas', 'INSERT') as puede",
    );
    expect(insert.rows[0]?.puede).toBe(false);
  });
});
