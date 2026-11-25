import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { deLaEmpresa, deLaMarca } from "../utilidades/alcance-del-host";
import { montarCatalogo } from "./catalogo-apoyo";
import {
  MARCA_DEL_HOST,
  adaptadorReal,
  montarEnsayo,
  type Catalogo,
  type Ensayo,
} from "./carta-publica-lectura-apoyo";
import type { BaseDePruebas } from "./global";

/**
 * P3 del dominio propio (0096): la raíz de la carta en un host DEDICADO a una empresa, con el rol público REAL. Lista las cartas EN LÍNEA de la empresa dueña del host que de verdad se sirven; en un
 * host compartido (dueño: la marca) no lista nada; nunca ve las de otra empresa. La política se prueba también sola, con SQL del rol público, para que ni un descuido del código abra más de lo debido.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

describe.skipIf(base === null)("raíz de la carta: las cartas de la empresa del host (0096)", () => {
  let c: Catalogo;
  let a: Ensayo;
  let b: Ensayo;
  let vidriera: ReturnType<typeof adaptadorReal>["vidriera"];
  let publicas: ReturnType<typeof adaptadorReal>["publicas"];

  beforeAll(async () => {
    c = await montarCatalogo(base as BaseDePruebas);
    a = await montarEnsayo(c);
    b = await montarEnsayo(c);
    ({ vidriera, publicas } = adaptadorReal(c));
  });
  afterAll(async () => {
    await publicas.cerrar();
    await c.cerrar();
  });

  const delA = () => deLaEmpresa(MARCA_DEL_HOST, a.e.empresa);
  const codigos = async (alcance = delA()) =>
    (await vidriera.listarDelHost(alcance)).map((x) => x.codigo).sort();

  it("el host de la empresa A lista sus dos cartas en línea, con nombre, rubro y lugar, y ninguna de B", async () => {
    const lista = await vidriera.listarDelHost(delA());
    expect(lista.map((x) => x.codigo).sort()).toEqual([a.carta1.codigo, a.carta2.codigo].sort());
    for (const carta of lista) {
      expect(Object.keys(carta).sort()).toEqual(["codigo", "lugar", "nombre", "rubro"]);
      expect(carta.nombre.length).toBeGreaterThan(0);
    }
    expect(lista.map((x) => x.codigo)).not.toContain(b.carta1.codigo);
    expect(lista.map((x) => x.nombre)).toEqual([...lista.map((x) => x.nombre)].sort());
  });

  it("el host de B lista solo las de B", async () => {
    expect(await codigos(deLaEmpresa(MARCA_DEL_HOST, b.e.empresa))).toEqual(
      [b.carta1.codigo, b.carta2.codigo].sort(),
    );
  });

  it("el host compartido (dueño: la marca) NO lista nada, aunque haya cartas en línea", async () => {
    expect(await vidriera.listarDelHost(deLaMarca(MARCA_DEL_HOST))).toEqual([]);
  });

  it("una empresa sin cartas, o un id que no existe, da lista vacía", async () => {
    const sin = (await c.escenario()).empresa;
    expect(await vidriera.listarDelHost(deLaEmpresa(MARCA_DEL_HOST, sin))).toEqual([]);
    expect(
      await vidriera.listarDelHost(
        deLaEmpresa(MARCA_DEL_HOST, "00000000-0000-4000-8000-0000000000ff"),
      ),
    ).toEqual([]);
    expect(await vidriera.listarDelHost(deLaEmpresa(MARCA_DEL_HOST, "no-es-un-id"))).toEqual([]);
  });

  it("una carta fuera de línea, o con la sucursal cerrada, no se lista (lo mismo que `/<código>` no serviría)", async () => {
    await c.dueno.query("update carta_publica set estado = 'FUERA_DE_LINEA' where id = $1", [
      a.carta2.id,
    ]);
    expect(await codigos()).toEqual([a.carta1.codigo]);
    await c.dueno.query("update carta_publica set estado = 'EN_LINEA' where id = $1", [
      a.carta2.id,
    ]);
    await c.dueno.query("update sucursal set activa = false where id = $1", [a.e.otraSucursal]);
    expect(await codigos()).toEqual([a.carta1.codigo]);
    await c.dueno.query("update sucursal set activa = true where id = $1", [a.e.otraSucursal]);
    expect(await codigos()).toEqual([a.carta1.codigo, a.carta2.codigo].sort());
  });

  it("dos pedidos a la vez dan lo mismo (es una lectura: no escribe nada)", async () => {
    const pedidas = await Promise.all(Array.from({ length: 2 }, () => codigos()));
    for (const lista of pedidas) expect(lista).toEqual([a.carta1.codigo, a.carta2.codigo].sort());
  });

  describe("la política 0096 con el rol público real", () => {
    async function leer(ajustes: readonly [string, string][]): Promise<string[]> {
      const cliente = new pg.Client({ connectionString: c.propia.base.publico });
      await cliente.connect();
      try {
        await cliente.query("begin read only");
        for (const [nombre, valor] of ajustes) {
          await cliente.query("select set_config($1, $2, true)", [nombre, valor]);
        }
        const { rows } = await cliente.query<{ codigo: string }>(
          "select codigo from carta_publica order by codigo",
        );
        await cliente.query("rollback");
        return rows.map((r) => r.codigo);
      } finally {
        await cliente.end();
      }
    }
    const deA = () => [a.carta1.codigo, a.carta2.codigo].sort();

    it("sin ninguna variable no se ve ninguna carta (falla cerrado)", async () => {
      expect(await leer([])).toEqual([]);
    });

    it("con la empresa del host se ven solo las EN LÍNEA de esa empresa, nunca las de otra", async () => {
      expect(await leer([["app.empresa_del_host", a.e.empresa]])).toEqual(deA());
      await c.dueno.query("update carta_publica set estado = 'FUERA_DE_LINEA' where id = $1", [
        a.carta2.id,
      ]);
      expect(await leer([["app.empresa_del_host", a.e.empresa]])).toEqual([a.carta1.codigo]);
      await c.dueno.query("update carta_publica set estado = 'EN_LINEA' where id = $1", [
        a.carta2.id,
      ]);
      const deB = [b.carta1.codigo, b.carta2.codigo].sort();
      expect(await leer([["app.empresa_del_host", b.e.empresa]])).toEqual(deB);
    });

    it("un valor que no es un id, vacío o de una empresa inexistente da cero filas, sin error", async () => {
      for (const valor of ["", "no-es-un-id", "  ", a.e.empresa.toUpperCase(), "x".repeat(500)]) {
        expect(await leer([["app.empresa_del_host", valor]]), valor).toEqual([]);
      }
    });

    it("lo de siempre no cambia: con el código se ve esa carta y solo esa", async () => {
      expect(await leer([["app.codigo_de_carta", a.carta1.codigo]])).toEqual([a.carta1.codigo]);
    });

    it("no abre ninguna otra tabla: con la empresa del host el rol público sigue sin ver sucursales ni productos", async () => {
      const cliente = new pg.Client({ connectionString: c.propia.base.publico });
      await cliente.connect();
      try {
        await cliente.query("begin read only");
        await cliente.query("select set_config('app.empresa_del_host', $1, true)", [a.e.empresa]);
        for (const tabla of ["sucursal", "producto", "seccion_de_carta", "precio_de_venta"]) {
          const { rows } = await cliente.query<{ n: string }>(
            `select count(*)::text as n from ${tabla}`,
          );
          expect(rows[0]?.n, tabla).toBe("0");
        }
        await cliente.query("rollback");
      } finally {
        await cliente.end();
      }
    });
  });
});
