import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { ClaseDeUso } from "../../src/modulos/catalogo/publico";
import {
  montarCatalogo,
  nombreAlAzarDeProducto,
  nuevoId,
  valorDe,
  type EscenarioDeCatalogo,
} from "./catalogo-apoyo";

/**
 * Las consultas de la pantalla de Secciones (backend): `listarSeccionesParaGestionar` (todas las secciones de la empresa, activas y desactivadas, con la
 * cantidad de productos de cualquier estado, en el orden de la carta) y el filtro `seccionId` de `listarProductos`. Con la base real y los casos de uso reales:
 * aislamiento entre empresas (una sección de otra empresa no se ve ni filtra), permiso `productos.ver` y módulo activo.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

describe.skipIf(base === null)("catálogo: consultas de la pantalla de secciones", () => {
  let c: Awaited<ReturnType<typeof montarCatalogo>>;
  let e: EscenarioDeCatalogo;
  let otra: EscenarioDeCatalogo;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarCatalogo(base);
    e = await c.escenario();
    otra = await c.escenario();
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const crearSeccion = async (escenario: EscenarioDeCatalogo, nombre: string, orden: number) => {
    const id = nuevoId();
    valorDe(await c.casos.crearSeccionDeCarta(escenario.gerente, { id, nombre, orden }));
    return id;
  };
  const nuevoProducto = async (escenario: EscenarioDeCatalogo, seccionDeCartaId?: string) =>
    valorDe(
      await c.casos.crearProducto(escenario.gerente, {
        id: nuevoId(),
        claseDeUso: "VENDIBLE",
        nombre: nombreAlAzarDeProducto(),
        unidadBaseId: "UNIDAD",
        alicuota: "21",
        ...(seccionDeCartaId === undefined ? {} : { seccionDeCartaId }),
      }),
    ).productoId;

  describe("listarSeccionesParaGestionar", () => {
    it("trae TODAS las secciones de la empresa (activas y apagadas) en el orden de la carta, con la cantidad de productos de cualquier estado", async () => {
      const entrada = await crearSeccion(e, nombreAlAzarDeProducto("Entradas"), 2);
      const postres = await crearSeccion(e, nombreAlAzarDeProducto("Postres"), 1);
      const vacia = await crearSeccion(e, nombreAlAzarDeProducto("Vacía"), 3);
      const apagada = await crearSeccion(e, nombreAlAzarDeProducto("Apagada"), 4);
      await nuevoProducto(e, entrada);
      await nuevoProducto(e, entrada);
      const inactivo = await nuevoProducto(e, entrada);
      valorDe(await c.casos.desactivarProducto(e.gerente, { productoId: inactivo }));
      await nuevoProducto(e, postres);
      await nuevoProducto(e, apagada);
      valorDe(await c.casos.desactivarSeccionDeCarta(e.gerente, { seccionId: apagada }));
      // Una sección de OTRA empresa con productos no aparece ni cuenta acá.
      const ajena = await crearSeccion(otra, nombreAlAzarDeProducto("Ajena"), 1);
      await nuevoProducto(otra, ajena);

      const lista = valorDe(await c.consultas.listarSeccionesParaGestionar(e.gerente));
      const mias = lista.filter((s) => [entrada, postres, vacia, apagada].includes(s.id));
      // Orden de la carta: (orden, nombre, id): Postres (1), Entradas (2), Vacía (3), Apagada (4).
      expect(mias.map((s) => [s.id, s.orden, s.activa, s.productos])).toEqual([
        [postres, 1, true, 1],
        [entrada, 2, true, 3],
        [vacia, 3, true, 0],
        [apagada, 4, false, 1],
      ]);
      expect(lista.some((s) => s.id === ajena)).toBe(false);
      for (const s of lista) {
        expect(s).toEqual({
          id: expect.any(String) as unknown,
          nombre: expect.any(String) as unknown,
          orden: expect.any(Number) as unknown,
          activa: expect.any(Boolean) as unknown,
          version: expect.any(Number) as unknown,
          productos: expect.any(Number) as unknown,
        });
      }
      // La otra empresa ve solo la suya, con su cantidad.
      const deLaOtra = valorDe(await c.consultas.listarSeccionesParaGestionar(otra.gerente));
      expect(deLaOtra.find((s) => s.id === ajena)?.productos).toBe(1);
      expect(deLaOtra.some((s) => s.id === entrada)).toBe(false);
    });

    it("repetirla da lo mismo y no escribe nada (lectura); el operador la ve (productos.ver) y sin el módulo activo no se ve", async () => {
      const escritasAntes = await c.contar(
        "select count(*) as n from auditoria_empresa where empresa_id = $1",
        [e.empresa],
      );
      const uno = valorDe(await c.consultas.listarSeccionesParaGestionar(e.gerente));
      const dos = valorDe(await c.consultas.listarSeccionesParaGestionar(e.gerente));
      expect(dos).toEqual(uno);
      expect(valorDe(await c.consultas.listarSeccionesParaGestionar(e.operador))).toEqual(uno);
      expect(
        await c.contar("select count(*) as n from auditoria_empresa where empresa_id = $1", [
          e.empresa,
        ]),
      ).toBe(escritasAntes);
    });
  });

  describe("listarProductos con seccionId", () => {
    it("trae solo los productos de esa sección (de cualquier estado); otra empresa, inexistente o un texto que no es uuid dan lista vacía", async () => {
      const seccion = await crearSeccion(e, nombreAlAzarDeProducto("Filtro"), 10);
      const a = await nuevoProducto(e, seccion);
      const b = await nuevoProducto(e, seccion);
      valorDe(await c.casos.desactivarProducto(e.gerente, { productoId: b }));
      const sinSeccion = await nuevoProducto(e);
      const ajena = await crearSeccion(otra, nombreAlAzarDeProducto("FiltroAjena"), 10);
      const deLaAjena = await nuevoProducto(otra, ajena);

      const ids = async (filtro: Record<string, unknown>, quien = e.gerente) =>
        valorDe(await c.consultas.listarProductos(quien, filtro)).productos.map((p) => p.id);
      expect((await ids({ seccionId: seccion })).sort()).toEqual([a, b].sort());
      expect(await ids({ seccionId: seccion, activo: true })).toEqual([a]);
      expect(await ids({ seccionId: seccion })).not.toContain(sinSeccion);
      // Aislamiento: la sección de la otra empresa, desde esta, no devuelve nada (ni el producto ajeno).
      expect(await ids({ seccionId: ajena })).toEqual([]);
      expect(await ids({ seccionId: nuevoId() })).toEqual([]);
      expect(await ids({ seccionId: "no-es-un-uuid" })).toEqual([]);
      // Y desde la otra empresa, la suya sí.
      expect(await ids({ seccionId: ajena }, otra.gerente)).toEqual([deLaAjena]);
      expect(await ids({ seccionId: seccion }, otra.gerente)).toEqual([]);
    });
  });

  describe("listarProductos: version y varias clases (faltantes de la pantalla de Secciones)", () => {
    it("cada fila trae la `version` del producto, la que exige editarProducto", async () => {
      const a = await nuevoProducto(e);
      const fila = valorDe(await c.consultas.listarProductos(e.gerente, {})).productos.find(
        (p) => p.id === a,
      );
      const ficha = valorDe(await c.consultas.verProducto(e.gerente, { productoId: a }));
      expect(fila?.version).toBeTypeOf("number");
      expect(fila?.version).toBe(ficha?.producto.version);
    });

    it("`claseDeUso` acepta una clase (como siempre) o varias; una lista vacía no ensancha el filtro: no trae nada", async () => {
      const vendible = await nuevoProducto(e);
      const reventa = valorDe(
        await c.casos.crearProductoRapido(e.gerente, {
          id: nuevoId(),
          claseDeUso: "REVENTA",
          nombre: nombreAlAzarDeProducto("Gaseosa"),
          unidadBaseId: "UNIDAD",
        }),
      ).productoId;
      const insumo = valorDe(
        await c.casos.crearProductoRapido(e.gerente, {
          id: nuevoId(),
          claseDeUso: "INSUMO",
          nombre: nombreAlAzarDeProducto("Servilleta"),
          unidadBaseId: "UNIDAD",
        }),
      ).productoId;
      const ids = async (claseDeUso: ClaseDeUso | readonly ClaseDeUso[]) =>
        valorDe(await c.consultas.listarProductos(e.gerente, { claseDeUso })).productos.map(
          (p) => p.id,
        );
      expect(await ids("REVENTA")).toContain(reventa);
      expect(await ids("REVENTA")).not.toContain(vendible);
      const dos = await ids(["VENDIBLE", "REVENTA"]);
      expect(dos).toEqual(expect.arrayContaining([vendible, reventa]));
      expect(dos).not.toContain(insumo);
      expect(await ids([])).toEqual([]);
    });
  });
});
