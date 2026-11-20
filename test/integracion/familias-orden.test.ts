import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  montarCatalogo,
  productoDeBase,
  valorDe,
  type EscenarioDeCatalogo,
} from "./catalogo-apoyo";
import { nombreUnico } from "./unicos";

/**
 * F3 de familias (A8) contra una base real: el orden a mano de los renglones de una sección (familias agrupadas y productos sueltos) y la estrella (★), por empresa.
 * Críticos: la repetición, dos reordenamientos a la vez, una lista que no es exactamente la de la sección, todo o nada, el aislamiento y el permiso.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

describe.skipIf(base === null)("familias: orden y estrella (F3)", () => {
  let c: Awaited<ReturnType<typeof montarCatalogo>>;
  beforeAll(async () => {
    if (base !== null) c = await montarCatalogo(base);
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const auditorias = async (e: EscenarioDeCatalogo, accion: string) =>
    (await c.auditoria(e.empresa, accion)).length;

  /** Una sección con: la familia «Café» agrupada (2 productos), «Té» y «Agua» sueltos. Renglones alfabéticos: Agua, Café (familia), Té. */
  const ensayo = async () => {
    const e = await c.escenario();
    const seccion = randomUUID();
    await c.dueno.query(
      "insert into seccion_de_carta (id, empresa_id, nombre, nombre_clave, orden) values ($1, $2, $3, lower($3), 0)",
      [seccion, e.empresa, nombreUnico("Cafeteria")],
    );
    const producto = async (nombre: string) => {
      const id = await productoDeBase(c.dueno, e.empresa, { nombre });
      await c.dueno.query("update producto set seccion_de_carta_id = $2 where id = $1", [
        id,
        seccion,
      ]);
      return id;
    };
    const te = await producto("Té");
    const agua = await producto("Agua");
    const espresso = await producto("Espresso");
    const cortado = await producto("Cortado");
    const cafe = valorDe(
      await c.casos.crearFamilia(e.gerente, { id: randomUUID(), nombre: "Café" }),
    ).familiaId;
    valorDe(
      await c.casos.agregarProductoAFamilia(e.gerente, {
        familiaId: cafe,
        productoId: espresso,
        versionEsperada: 1,
      }),
    );
    valorDe(
      await c.casos.agregarProductoAFamilia(e.gerente, {
        familiaId: cafe,
        productoId: cortado,
        versionEsperada: 2,
      }),
    );
    valorDe(
      await c.casos.editarFamilia(e.gerente, {
        familiaId: cafe,
        versionEsperada: 3,
        agruparEnCarta: true,
      }),
    );
    return { e, seccion, cafe, p: { te, agua, espresso, cortado } };
  };
  const renglones = (x: Awaited<ReturnType<typeof ensayo>>, orden: ("te" | "agua" | "cafe")[]) =>
    orden.map((k) =>
      k === "cafe"
        ? ({ tipo: "FAMILIA", id: x.cafe } as const)
        : ({ tipo: "PRODUCTO", id: x.p[k] } as const),
    );
  const ordenGuardado = async (x: Awaited<ReturnType<typeof ensayo>>) => {
    const f = await c.dueno.query<{ orden: number }>(
      "select orden from familia_de_producto where id = $1",
      [x.cafe],
    );
    const p = await c.dueno.query<{ producto_id: string; orden: number }>(
      "select producto_id, orden from lugar_en_carta_de_producto where empresa_id = $1",
      [x.e.empresa],
    );
    return {
      familia: f.rows[0]?.orden,
      productos: Object.fromEntries(p.rows.map((r) => [r.producto_id, r.orden])),
    };
  };

  it("ordenar: repetir el orden ya aplicado es yaEstaba aunque la versión del orden sea vieja, sin escribir ni auditar", async () => {
    const x = await ensayo();
    const pedido = {
      seccionId: x.seccion,
      versionDelOrdenEsperada: 1,
      modo: "A_MANO" as const,
      renglones: renglones(x, ["te", "cafe", "agua"]),
    };
    const primera = valorDe(await c.casos.ordenarRenglonesDeSeccion(x.e.gerente, pedido));
    expect(primera).toEqual({ versionDelOrden: 2, yaEstaba: false, movidos: 3 });
    expect(await ordenGuardado(x)).toEqual({
      familia: 1,
      productos: { [x.p.te]: 0, [x.p.agua]: 2 },
    });
    const segunda = valorDe(await c.casos.ordenarRenglonesDeSeccion(x.e.gerente, pedido));
    expect(segunda).toEqual({ versionDelOrden: 2, yaEstaba: true, movidos: 0 });
    expect(await auditorias(x.e, "ORDEN_DE_CARTA_CAMBIADO")).toBe(1);
  });

  it("una lista que no es exactamente la de la sección se rechaza entera y no deja nada hecho", async () => {
    const x = await ensayo();
    const pedir = (lista: ReturnType<typeof renglones>) =>
      c.casos.ordenarRenglonesDeSeccion(x.e.gerente, {
        seccionId: x.seccion,
        versionDelOrdenEsperada: 1,
        modo: "A_MANO",
        renglones: lista,
      });
    expect(await pedir(renglones(x, ["te", "cafe"]))).toEqual({
      ok: false,
      error: "LISTA_DE_RENGLONES_INCOMPLETA",
    });
    expect(await pedir(renglones(x, ["te", "cafe", "te"]))).toEqual({
      ok: false,
      error: "RENGLON_REPETIDO",
    });
    // Un miembro de la familia agrupada no es un renglón suelto.
    expect(
      await pedir([...renglones(x, ["te", "agua"]), { tipo: "PRODUCTO", id: x.p.espresso }]),
    ).toEqual({ ok: false, error: "RENGLON_NO_ENCONTRADO" });
    expect(await ordenGuardado(x)).toEqual({ familia: 0, productos: {} });
    expect(await auditorias(x.e, "ORDEN_DE_CARTA_CAMBIADO")).toBe(0);
  });

  it("con una versión vieja del orden se rechaza todo; con la nueva entra; volver a «Alfabético» es un estado", async () => {
    const x = await ensayo();
    const pedido = (version: number, lista: ReturnType<typeof renglones>) => ({
      seccionId: x.seccion,
      versionDelOrdenEsperada: version,
      modo: "A_MANO" as const,
      renglones: lista,
    });
    valorDe(
      await c.casos.ordenarRenglonesDeSeccion(
        x.e.gerente,
        pedido(1, renglones(x, ["te", "cafe", "agua"])),
      ),
    );
    expect(
      await c.casos.ordenarRenglonesDeSeccion(
        x.e.gerente,
        pedido(1, renglones(x, ["cafe", "te", "agua"])),
      ),
    ).toEqual({ ok: false, error: "VERSION_DESACTUALIZADA" });
    const nueva = valorDe(
      await c.casos.ordenarRenglonesDeSeccion(
        x.e.gerente,
        pedido(2, renglones(x, ["cafe", "te", "agua"])),
      ),
    );
    expect(nueva).toMatchObject({ versionDelOrden: 3, yaEstaba: false });
    const alfa = valorDe(
      await c.casos.ordenarRenglonesDeSeccion(x.e.gerente, {
        seccionId: x.seccion,
        versionDelOrdenEsperada: 3,
        modo: "ALFABETICO",
      }),
    );
    expect(alfa).toEqual({ versionDelOrden: 4, yaEstaba: false, movidos: 0 });
    expect(
      valorDe(
        await c.casos.ordenarRenglonesDeSeccion(x.e.gerente, {
          seccionId: x.seccion,
          versionDelOrdenEsperada: 1,
          modo: "ALFABETICO",
        }),
      ),
    ).toMatchObject({ yaEstaba: true });
  });

  it("dos reordenamientos a la vez desde la misma versión: gana uno y el otro es VERSION_DESACTUALIZADA", async () => {
    const x = await ensayo();
    const pedir = (lista: ReturnType<typeof renglones>) =>
      c.casos.ordenarRenglonesDeSeccion(x.e.gerente, {
        seccionId: x.seccion,
        versionDelOrdenEsperada: 1,
        modo: "A_MANO",
        renglones: lista,
      });
    const [a, b] = await Promise.all([
      pedir(renglones(x, ["te", "cafe", "agua"])),
      pedir(renglones(x, ["agua", "te", "cafe"])),
    ]);
    expect([a, b].map((r) => (r.ok ? "ok" : r.error)).sort()).toEqual([
      "VERSION_DESACTUALIZADA",
      "ok",
    ]);
    const guardado = await ordenGuardado(x);
    const ganador = a.ok
      ? renglones(x, ["te", "cafe", "agua"])
      : renglones(x, ["agua", "te", "cafe"]);
    const esperado = {
      familia: ganador.findIndex((r) => r.tipo === "FAMILIA"),
      productos: Object.fromEntries(
        ganador.flatMap((r, i) => (r.tipo === "PRODUCTO" ? [[r.id, i]] : [])),
      ),
    };
    expect(guardado).toEqual(esperado);
  });

  it("el operador no ordena; otra empresa no ve la sección", async () => {
    const x = await ensayo();
    const otra = await c.escenario();
    const pedido = {
      seccionId: x.seccion,
      versionDelOrdenEsperada: 1,
      modo: "ALFABETICO" as const,
    };
    expect(await c.casos.ordenarRenglonesDeSeccion(x.e.operador, pedido)).toMatchObject({
      ok: false,
    });
    expect(await c.casos.ordenarRenglonesDeSeccion(otra.gerente, pedido)).toEqual({
      ok: false,
      error: "SECCION_NO_ENCONTRADA",
    });
    expect(
      await c.casos.ordenarRenglonesDeSeccion(x.e.gerente, { ...pedido, modo: "AL_AZAR" as never }),
    ).toEqual({ ok: false, error: "MODO_DE_ORDEN_INVALIDO" });
  });

  it("destacar: encender dos veces la misma estrella es yaEstaba, sin escribir ni auditar la segunda", async () => {
    const x = await ensayo();
    const familia = { tipo: "FAMILIA" as const, id: x.cafe, destacado: true };
    expect(valorDe(await c.casos.destacarRenglon(x.e.gerente, familia))).toEqual({
      yaEstaba: false,
    });
    expect(valorDe(await c.casos.destacarRenglon(x.e.gerente, familia))).toEqual({
      yaEstaba: true,
    });
    expect(await auditorias(x.e, "RENGLON_DESTACADO")).toBe(1);
    const producto = { tipo: "PRODUCTO" as const, id: x.p.te, destacado: true };
    expect(valorDe(await c.casos.destacarRenglon(x.e.gerente, producto))).toEqual({
      yaEstaba: false,
    });
    expect(valorDe(await c.casos.destacarRenglon(x.e.gerente, producto))).toEqual({
      yaEstaba: true,
    });
    expect(
      valorDe(await c.casos.destacarRenglon(x.e.gerente, { ...producto, destacado: false })),
    ).toEqual({ yaEstaba: false });
    expect(await auditorias(x.e, "RENGLON_DESTACADO")).toBe(3);
  });

  it("la estrella no pisa el lugar ni al revés; no hay tope de estrellas; dos pedidos a la vez dejan una sola escritura", async () => {
    const x = await ensayo();
    valorDe(
      await c.casos.ordenarRenglonesDeSeccion(x.e.gerente, {
        seccionId: x.seccion,
        versionDelOrdenEsperada: 1,
        modo: "A_MANO",
        renglones: renglones(x, ["te", "cafe", "agua"]),
      }),
    );
    const [a, b] = await Promise.all([
      c.casos.destacarRenglon(x.e.gerente, { tipo: "PRODUCTO", id: x.p.te, destacado: true }),
      c.casos.destacarRenglon(x.e.gerente, { tipo: "PRODUCTO", id: x.p.te, destacado: true }),
    ]);
    expect([valorDe(a).yaEstaba, valorDe(b).yaEstaba].sort()).toEqual([false, true]);
    expect(await auditorias(x.e, "RENGLON_DESTACADO")).toBe(1);
    const { rows } = await c.dueno.query(
      "select orden, destacado from lugar_en_carta_de_producto where producto_id = $1",
      [x.p.te],
    );
    expect(rows[0]).toEqual({ orden: 0, destacado: true });
    valorDe(
      await c.casos.destacarRenglon(x.e.gerente, {
        tipo: "PRODUCTO",
        id: x.p.agua,
        destacado: true,
      }),
    );
    valorDe(
      await c.casos.destacarRenglon(x.e.gerente, { tipo: "FAMILIA", id: x.cafe, destacado: true }),
    );
    const todas = await c.dueno.query(
      "select count(*)::int as n from lugar_en_carta_de_producto where empresa_id = $1 and destacado",
      [x.e.empresa],
    );
    expect(todas.rows[0]).toEqual({ n: 2 });
  });

  it("destacar: lo de otra empresa o inexistente no existe; un producto que no se vende no se destaca; el operador no puede", async () => {
    const x = await ensayo();
    const otra = await c.escenario();
    expect(
      await c.casos.destacarRenglon(otra.gerente, { tipo: "FAMILIA", id: x.cafe, destacado: true }),
    ).toEqual({ ok: false, error: "FAMILIA_NO_ENCONTRADA" });
    expect(
      await c.casos.destacarRenglon(otra.gerente, {
        tipo: "PRODUCTO",
        id: x.p.te,
        destacado: true,
      }),
    ).toEqual({ ok: false, error: "PRODUCTO_NO_ENCONTRADO" });
    const insumo = await productoDeBase(c.dueno, x.e.empresa, { clase: "INSUMO" });
    expect(
      await c.casos.destacarRenglon(x.e.gerente, { tipo: "PRODUCTO", id: insumo, destacado: true }),
    ).toEqual({ ok: false, error: "PRODUCTO_NO_VENDIBLE" });
    expect(
      await c.casos.destacarRenglon(x.e.operador, { tipo: "FAMILIA", id: x.cafe, destacado: true }),
    ).toMatchObject({ ok: false });
    expect(
      await c.casos.destacarRenglon(x.e.gerente, {
        tipo: "FAMILIA",
        id: "no-es-uuid",
        destacado: true,
      }),
    ).toEqual({ ok: false, error: "IDENTIFICADOR_INVALIDO" });
  });
});
