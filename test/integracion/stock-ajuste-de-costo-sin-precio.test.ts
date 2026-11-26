import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  crearAjusteDeCostoPorOrigen,
  type EntradaDeAjusteDeCosto,
} from "../../src/modulos/stock/publico";
import {
  aLaVez,
  montarStock,
  nuevoId,
  RONDAS,
  valorDe,
  type EscenarioDeStock,
  type MontajeDeStock,
} from "./stock-casos-apoyo";

/**
 * Corregir el costo de una compra que entró SIN precio (`costoAnterior = null`): solo ganan costo las unidades que hoy no lo tienen. Con base real:
 * el ejemplo 10 / 6 / 8 (hay 10, 6 con costo, la compra sin precio entró 8: lo valorizado queda en 10 y el promedio pondera solo 4 unidades nuevas) y dos
 * correcciones de la misma compra a la vez (la segunda ya no tiene unidades sin costo: no cambia nada y lo valorizado no pasa de la existencia).
 * La repetición con la misma clave de una corrección de compra la cubre `compras-correcciones.test.ts` (I6): la clave es de la compra, no del puerto de stock.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("stock: corregir el costo de una compra sin precio", () => {
  let c: MontajeDeStock;
  let e: EscenarioDeStock;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarStock(base);
    e = await c.escenario();
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const entrada = (dep: string, producto: string, cantidad: string, costoUnitario?: string) =>
    c.casos.registrarEntrada(e.gerente, {
      clave: nuevoId(),
      depositoId: dep,
      motivo: "COMPRA",
      renglones: [
        {
          productoId: producto,
          cantidad,
          unidadId: "UNIDAD",
          ...(costoUnitario === undefined ? {} : { costoUnitario }),
        },
      ],
    });
  const ajustar = (entradaDeAjuste: EntradaDeAjusteDeCosto) => {
    const puerto = crearAjusteDeCostoPorOrigen({ reglas: c.reglas });
    return c.entorno.ejecutar({ contexto: e.gerente }, (tx) =>
      puerto.ajustar(tx, e.gerente, entradaDeAjuste),
    );
  };
  const estadoDe = async (dep: string, articulo: string) =>
    (
      await c.filas<{ costo: string; valorizada: string }>(
        `select costo_unitario::text as costo, cantidad_valorizada::text as valorizada
           from costo_de_articulo where deposito_id = $1 and articulo_id = $2`,
        [dep, articulo],
      )
    )[0] ?? null;
  const correccion = (dep: string, producto: string, entro: string): EntradaDeAjusteDeCosto => ({
    origen: { tipo: "CORRECCION_DE_COMPRA", id: nuevoId() },
    depositoId: dep,
    productoId: producto,
    costoAnterior: null,
    costoNuevo: "40.000000",
    cantidadQueEntro: entro,
  });
  /** Hay 10: 6 con costo 100 y 4 sin precio (la compra sin precio entró 8, parte ya consumida). */
  const montaje = async () => {
    const dep = await c.deposito(e);
    const { producto, articulo } = await c.articulo(e);
    valorDe(await entrada(dep, producto, "4"));
    valorDe(await entrada(dep, producto, "6", "100"));
    expect(await c.existencia(dep, articulo)).toBe("10.0000");
    expect(await estadoDe(dep, articulo)).toEqual({ costo: "100.000000", valorizada: "6.0000" });
    return { dep, producto, articulo };
  };

  it("el ejemplo 10 / 6 / 8: solo las 4 unidades sin costo toman el costo nuevo y lo valorizado queda en 10", async () => {
    const m = await montaje();
    const r = valorDe(await ajustar(correccion(m.dep, m.producto, "8")));
    expect(r.costoAntes).toBe("100.000000");
    expect(r.costoDespues).toBe("76.000000");
    expect(await estadoDe(m.dep, m.articulo)).toEqual({
      costo: "76.000000",
      valorizada: "10.0000",
    });
  });

  it("con todo ya valorizado la corrección no cambia el estado ni lo valorizado", async () => {
    const m = await montaje();
    valorDe(await ajustar(correccion(m.dep, m.producto, "8")));
    const r = valorDe(await ajustar(correccion(m.dep, m.producto, "8")));
    expect(r.costoAntes).toBe(r.costoDespues);
    expect(await estadoDe(m.dep, m.articulo)).toEqual({
      costo: "76.000000",
      valorizada: "10.0000",
    });
  });

  it("dos correcciones a la vez de la misma compra aplican las unidades sin costo una sola vez (varias rondas)", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const m = await montaje();
      const rs = await aLaVez(
        c,
        [
          () => ajustar(correccion(m.dep, m.producto, "8")),
          () => ajustar(correccion(m.dep, m.producto, "8")),
        ],
        ronda,
      );
      expect(rs.every((r) => r.ok)).toBe(true);
      expect(await estadoDe(m.dep, m.articulo)).toEqual({
        costo: "76.000000",
        valorizada: "10.0000",
      });
      expect(await c.existencia(m.dep, m.articulo)).toBe("10.0000");
    }
  });
});
