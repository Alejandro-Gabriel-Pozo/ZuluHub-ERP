import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  grupoDeBase,
  montarCatalogo,
  opcionDeBase,
  precioDeBase,
  productoDeBase,
  valorDe,
  type EscenarioDeCatalogo,
} from "./catalogo-apoyo";
import { nombreUnico } from "./unicos";

/** Las consultas de familias (F1, A8) contra una base real: la lista, la ficha con sus medidas y precios, cómo saldría en la carta, el permiso y el aislamiento por empresa. */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

describe.skipIf(base === null)("familias: consultas (F1)", () => {
  let c: Awaited<ReturnType<typeof montarCatalogo>>;
  beforeAll(async () => {
    if (base !== null) c = await montarCatalogo(base);
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const familia = async (e: EscenarioDeCatalogo, nombre = nombreUnico("Familia")) =>
    valorDe(await c.casos.crearFamilia(e.gerente, { id: randomUUID(), nombre })).familiaId;
  const agregar = async (e: EscenarioDeCatalogo, familiaId: string, productoId: string) => {
    const f = valorDe(await c.consultas.verFamilia(e.gerente, { familiaId }));
    valorDe(
      await c.casos.agregarProductoAFamilia(e.gerente, {
        familiaId,
        productoId,
        versionEsperada: f.familia.version,
      }),
    );
  };
  /** Un producto con medidas Chico, Mediano y Grande y un precio por medida. */
  const cafe = async (e: EscenarioDeCatalogo, precios: [string, string, string]) => {
    const p = await productoDeBase(c.dueno, e.empresa, { nombre: nombreUnico("Cafe") });
    const g = await grupoDeBase(c.dueno, e.empresa, p, {
      clase: "VARIANTE",
      esTamano: true,
      nombre: "Medida",
    });
    for (const [i, nombre] of ["Chico", "Mediano", "Grande"].entries()) {
      const { opcion } = await opcionDeBase(c.dueno, e.empresa, p, g, { nombre });
      await c.dueno.query("update opcion set orden = $2 where id = $1", [opcion, i]);
      await precioDeBase(c.dueno, {
        empresa: e.empresa,
        producto: p,
        opcion,
        precio: precios[i] as string,
        desde: "2026-10-01T00:00:00Z",
      });
    }
    return p;
  };
  const conPrecio = async (e: EscenarioDeCatalogo, precio: string) => {
    const p = await productoDeBase(c.dueno, e.empresa, { nombre: nombreUnico("Gaseosa") });
    await precioDeBase(c.dueno, {
      empresa: e.empresa,
      producto: p,
      precio,
      desde: "2026-10-01T00:00:00Z",
    });
    return p;
  };

  it("listarFamilias: por nombre, con interruptores, versión y cuántos productos; el operador mira; otra empresa no ve", async () => {
    const e = await c.escenario();
    const otra = await c.escenario();
    const b = await familia(e, "Bebidas");
    const a = await familia(e, "Alfajores");
    await agregar(e, a, await conPrecio(e, "1000"));
    await familia(otra, "Ajena");
    const lista = valorDe(await c.consultas.listarFamilias(e.operador));
    expect(lista.map((f) => f.nombre)).toEqual(["Alfajores", "Bebidas"]);
    expect(lista[0]).toMatchObject({
      id: a,
      miembros: 1,
      version: 2,
      agruparEnCarta: false,
      agruparEnPos: false,
      activa: true,
    });
    expect(lista[1]).toMatchObject({ id: b, miembros: 0, version: 1 });
    expect(valorDe(await c.consultas.listarFamilias(otra.gerente)).map((f) => f.nombre)).toEqual([
      "Ajena",
    ]);
  });

  it("verFamilia: los cafés con tres medidas salen en TABLA con las medidas por orden y el precio de cada una", async () => {
    const e = await c.escenario();
    const f = await familia(e, "Café");
    await agregar(e, f, await cafe(e, ["2000", "2300", "2600"]));
    await agregar(e, f, await cafe(e, ["2000", "2300", "2800"]));
    valorDe(
      await c.casos.editarFamilia(e.gerente, {
        familiaId: f,
        versionEsperada: 3,
        agruparEnCarta: true,
      }),
    );
    const ficha = valorDe(await c.consultas.verFamilia(e.operador, { familiaId: f }));
    expect(ficha.familia).toMatchObject({
      nombre: "Café",
      agruparEnCarta: true,
      miembros: 2,
      version: 4,
    });
    expect(ficha.miembros.map((m) => m.posicion)).toEqual([1, 2]);
    expect(ficha.miembros[1]?.medidas.map((m) => [m.nombre, m.precio])).toEqual([
      ["Chico", "2000.000000"],
      ["Mediano", "2300.000000"],
      ["Grande", "2800.000000"],
    ]);
    expect(ficha.formaEnLaCarta).toMatchObject({
      forma: "TABLA",
      medidas: ["Chico", "Mediano", "Grande"],
    });
    expect(ficha.formaEnLaCarta.productos).toHaveLength(2);
  });

  it("verFamilia: sin medidas y al mismo precio sale una línea; con otro precio, sueltos; apagada la carta, sueltos", async () => {
    const e = await c.escenario();
    const f = await familia(e, "Gaseosa 500 cc");
    await agregar(e, f, await conPrecio(e, "2200"));
    await agregar(e, f, await conPrecio(e, "2200"));
    const version = valorDe(await c.consultas.verFamilia(e.gerente, { familiaId: f })).familia
      .version;
    expect(
      valorDe(await c.consultas.verFamilia(e.gerente, { familiaId: f })).formaEnLaCarta,
    ).toMatchObject({ forma: "SUELTOS", motivo: "CARTA_APAGADA" });
    valorDe(
      await c.casos.editarFamilia(e.gerente, {
        familiaId: f,
        versionEsperada: version,
        agruparEnCarta: true,
      }),
    );
    const igual = valorDe(await c.consultas.verFamilia(e.gerente, { familiaId: f }));
    expect(igual.formaEnLaCarta).toMatchObject({ forma: "LINEA", precio: "2200.000000" });
    await agregar(e, f, await conPrecio(e, "2500"));
    expect(
      valorDe(await c.consultas.verFamilia(e.gerente, { familiaId: f })).formaEnLaCarta,
    ).toMatchObject({ forma: "SUELTOS", motivo: "PRECIOS_DISTINTOS" });
  });

  it("verFamilia: un miembro desactivado queda fuera de la forma pero sigue en la ficha; una familia ajena o un id inválido no existen", async () => {
    const e = await c.escenario();
    const otra = await c.escenario();
    const f = await familia(e, "Con baja");
    const a = await conPrecio(e, "100");
    const b = await conPrecio(e, "100");
    await agregar(e, f, a);
    await agregar(e, f, b);
    await c.dueno.query("update producto set activo = false where id = $1", [b]);
    const ficha = valorDe(await c.consultas.verFamilia(e.gerente, { familiaId: f }));
    expect(ficha.miembros).toHaveLength(2);
    expect(ficha.formaEnLaCarta.productos).toEqual([a]);
    expect(await c.consultas.verFamilia(otra.gerente, { familiaId: f })).toEqual({
      ok: false,
      error: "FAMILIA_NO_ENCONTRADA",
    });
    expect(await c.consultas.verFamilia(e.gerente, { familiaId: "no-es-uuid" })).toEqual({
      ok: false,
      error: "FAMILIA_NO_ENCONTRADA",
    });
  });
});
